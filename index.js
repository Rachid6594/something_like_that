const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const qrcode = require('qrcode-terminal')
const P = require('pino')
const fs = require('fs')
const storage = require('./storage')

// Recipient and connection status are managed by the web dashboard.
const dashboard = require('./server')
let MY_JID = dashboard.getRecipient()
dashboard.onRecipientChange(number => { MY_JID = number })
dashboard.listen()

function log(text) {
  const line = `[${new Date().toISOString()}] ${text}`
  console.log(line)
  dashboard.addLog(text)
  fs.appendFileSync(storage.logPath, line + '\n')
}

function getQuotedMessage(msg) {
  return msg?.extendedTextMessage?.contextInfo?.quotedMessage
}

function isViewOnce(msg) {
  if (!msg) return false
  let current = msg
  for (let i = 0; i < 10; i++) {
    if (current?.viewOnceMessage || current?.viewOnceMessageV2 || current?.viewOnceMessageV2Extension) return true
    const next = current?.ephemeralMessage?.message || current?.associatedChildMessage?.message
    if (!next) break
    current = next
  }
  const inner = deepUnwrap(msg)
  return !!(inner?.imageMessage?.viewOnce || inner?.videoMessage?.viewOnce || inner?.audioMessage?.viewOnce)
}

/**
 * ✅ FULL UNWRAP (WORKING FIX)
 */
function deepUnwrap(msg) {
  let m = msg

  while (true) {
    if (m?.viewOnceMessage?.message) {
      m = m.viewOnceMessage.message
      continue
    }

    if (m?.viewOnceMessageV2?.message) {
      m = m.viewOnceMessageV2.message
      continue
    }

    if (m?.viewOnceMessageV2Extension?.message) {
      m = m.viewOnceMessageV2Extension.message
      continue
    }

    if (m?.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message
      continue
    }

    if (m?.associatedChildMessage?.message) {
      m = m.associatedChildMessage.message
      continue
    }

    if (m?.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message
      continue
    }

    if (m?.message) {
      m = m.message
      continue
    }

    break
  }

  return m
}

function getMedia(msg) {
  if (!msg) return null

  for (const key of ['imageMessage', 'videoMessage', 'audioMessage']) {
    const media = msg[key]
    if (media?.mediaKey) return { key, media }
  }

  return null
}

async function startBot() {
  dashboard.setConnection('connecting')
  log('🚀 Starting')

  const { state, saveCreds } = await useMultiFileAuthState(storage.authPath)
  const { version } = await fetchLatestBaileysVersion()

  const logger = P({ level: 'silent' })
  const sock = makeWASocket({
    version,
    auth: state,
    logger
  })

  const sent = new Set()
  const inFlight = new Set()

  async function forwardViewOnce(msg) {
    if (!msg?.message || !msg.key?.id || !isViewOnce(msg.message)) return false
    const from = msg.key.remoteJid
    if (!from || from === 'status@broadcast' || msg.key.fromMe) return false
    const id = `${from}:${msg.key.id}`
    if (sent.has(id) || inFlight.has(id)) return true

    if (!MY_JID) {
      log('Configure un numéro destinataire dans l’interface web.')
      return true
    }

    let mediaObj = getMedia(deepUnwrap(msg.message))
    if (!mediaObj) {
      log('❌ Media not found: clé du média absente du message ' + msg.key.id)
      return true
    }

    inFlight.add(id)
    try {
      log('📸 VIEW ONCE DETECTED ✅')
      if (!mediaObj.media.url && !mediaObj.media.directPath) {
        msg = await sock.updateMediaMessage(msg)
        mediaObj = getMedia(deepUnwrap(msg.message))
        if (!mediaObj?.media.url && !mediaObj?.media.directPath) {
          throw new Error('WhatsApp n’a pas fourni de lien pour ce média.')
        }
      }
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
        logger,
        reuploadRequest: sock.updateMediaMessage
      })
      log('✅ Downloaded (' + buffer.length + ' bytes)')

      if (mediaObj.key === 'imageMessage') {
        await sock.sendMessage(MY_JID, { image: buffer, caption: 'Recovered ✅' })
      } else if (mediaObj.key === 'videoMessage') {
        await sock.sendMessage(MY_JID, { video: buffer, caption: 'Recovered ✅' })
      } else {
        await sock.sendMessage(MY_JID, { document: buffer, fileName: 'recovered.bin' })
      }
      sent.add(id)
      if (sent.size > 1000) sent.delete(sent.values().next().value)
      log('📤 Sent to self ✅')
      return true
    } finally {
      inFlight.delete(id)
    }
  }

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      dashboard.setQr(qr)
      log('📱 Scan QR')
      if (!process.env.RENDER) qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      dashboard.setConnection('connected')
      log('✅ Connected')
    }

    if (connection === 'close') {
      dashboard.setConnection('disconnected')
      const code = lastDisconnect?.error?.output?.statusCode
      log('❌ Closed: ' + code)

      if (code === DisconnectReason.loggedOut) {
        log('Session WhatsApp déconnectée. Réinitialise le dossier auth puis redémarre le bot pour obtenir un nouveau QR.')
      }

      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => startBot().catch(err => {
          dashboard.setConnection('error')
          log(err.message)
        }), 3000)
      }
    }
  })

  sock.ev.on('creds.update', saveCreds)

  /**
   * ✅ MESSAGE HANDLER
   */
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        if (!msg.message) {
          if (msg.key?.isViewOnce) log('Message view-once reçu sans contenu; attente de messages.update')
          continue
        }

        const from = msg.key.remoteJid
        log('📩 Message from ' + from)

        if (await forwardViewOnce(msg)) continue

        const quoted = getQuotedMessage(msg.message)

        if (!quoted) continue

        if (!isViewOnce(quoted)) {
          log('➡️ Not view-once')
          continue
        }

        const context = msg.message.extendedTextMessage.contextInfo
        await forwardViewOnce({
          key: { remoteJid: from, id: context.stanzaId, participant: context.participant, fromMe: false },
          message: quoted
        })

      } catch (err) {
        log('❌ ' + err.message)
      }
    }
  })

  // Linked devices can receive the media body after the initial upsert.
  sock.ev.on('messages.update', async updates => {
    for (const { key, update } of updates) {
      if (!update?.message) continue
      try {
        await forwardViewOnce({ key, message: update.message })
      } catch (err) {
        log('❌ ' + err.message)
      }
    }
  })
}

if (process.env.DEMO_MODE !== 'true') {
  startBot().catch(err => {
    dashboard.setConnection('error')
    log(err.message)
  })
}
