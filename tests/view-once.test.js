const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

test('forwards media delivered in messages.update once, even after a quoted reply', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-view-once-'))
  const handlers = {}
  const sent = []
  let downloads = 0
  const socket = {
    ev: { on: (event, handler) => { handlers[event] = handler } },
    sendMessage: async (jid, content) => { sent.push({ jid, content }) },
    updateMediaMessage: async msg => msg
  }
  const baileys = {
    default: () => socket,
    useMultiFileAuthState: async () => ({ state: {}, saveCreds: () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
    downloadMediaMessage: async () => { downloads++; return Buffer.from('image') },
    DisconnectReason: { loggedOut: 401 }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === path.resolve(__dirname, '..', 'index.js')) {
      if (request === '@whiskeysockets/baileys') return baileys
      if (request === './server') return {
        getRecipient: () => '22670000000@s.whatsapp.net',
        onRecipientChange: () => {}, listen: () => {}, addLog: () => {},
        setConnection: () => {}, setQr: () => {}
      }
      if (request === './storage') return { authPath: tempDir, logPath: path.join(tempDir, 'bot.log') }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve('../index')]
    require('../index')
    await new Promise(resolve => setImmediate(resolve))

    const key = { remoteJid: 'sender@lid', id: 'original', fromMe: false, isViewOnce: true }
    await handlers['messages.upsert']({ type: 'notify', messages: [{ key, message: null }] })
    const media = { viewOnceMessageV2: { message: {
      imageMessage: { mediaKey: Buffer.from('secret'), directPath: '/encrypted/image' }
    } } }
    await handlers['messages.update']([{ key, update: { message: media } }])

    const reply = { extendedTextMessage: { contextInfo: {
      stanzaId: 'original', quotedMessage: media
    } } }
    await handlers['messages.upsert']({ type: 'notify', messages: [{
      key: { remoteJid: 'sender@lid', id: 'reply', fromMe: false }, message: reply
    }] })

    assert.equal(downloads, 1)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].jid, '22670000000@s.whatsapp.net')
    assert.deepEqual(sent[0].content.image, Buffer.from('image'))
  } finally {
    Module._load = originalLoad
    delete require.cache[require.resolve('../index')]
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
