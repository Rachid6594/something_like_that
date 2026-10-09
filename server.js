const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const { configPath } = require('./storage')
const publicOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL
let recipient = process.env.MY_NUMBER || ''
if (fs.existsSync(configPath)) recipient = JSON.parse(fs.readFileSync(configPath, 'utf8')).number || recipient
recipient = recipient.replace(/@s\.whatsapp\.net$/, '')
let onChange = () => {}
let qrVersion = 0
const state = { connection: 'idle', qr: null, logs: [], number: recipient }
function same(a, b) {
  const left = crypto.createHash('sha256').update(a).digest()
  const right = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(left, right)
}
function authorized(req) {
  const password = process.env.ADMIN_PASSWORD
  if (!password) return true
  const header = req.headers.authorization || ''
  if (!header.startsWith('Basic ')) return false
  return same(Buffer.from(header.slice(6), 'base64').toString(), `admin:${password}`)
}
function respond(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'" })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}
const server = http.createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') return respond(res, 200, { ok: true })
  if (!authorized(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="WA Bot", charset="UTF-8"')
    return respond(res, 401, { error: 'Connexion administrateur requise.' })
  }
  try {
    if (req.url === '/api/status' && req.method === 'GET') return respond(res, 200, state)
    if (req.url === '/api/config' && req.method === 'POST') {
      const localOrigin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`
      const allowedOrigin = publicOrigin ? new URL(publicOrigin).origin : localOrigin
      if (req.headers.origin && req.headers.origin !== allowedOrigin) return respond(res, 403, { error: 'Origine refusée.' })
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return respond(res, 415, { error: 'JSON requis.' })
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (body.length > 2048) return respond(res, 413, { error: 'Requête trop longue.' })
      }
      const { number } = JSON.parse(body)
      if (typeof number !== 'string' || !/^[1-9][0-9]{7,14}$/.test(number)) return respond(res, 400, { error: 'Entre 8 et 15 chiffres, avec indicatif pays, sans + ni espace.' })
      fs.writeFileSync(configPath, JSON.stringify({ number }, null, 2), { mode: 0o600 })
      recipient = number
      state.number = number
      onChange(`${number}@s.whatsapp.net`)
      return respond(res, 200, { ok: true })
    }
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] }
    if (req.method === 'GET' && files[req.url]) {
      const [file, type] = files[req.url]
      return respond(res, 200, fs.readFileSync(path.join(__dirname, 'public', file)), type)
    }
    respond(res, 404, { error: 'Page introuvable.' })
  } catch (err) {
    respond(res, err instanceof SyntaxError ? 400 : 500, { error: err instanceof SyntaxError ? 'JSON invalide.' : 'Erreur du serveur.' })
  }
})
module.exports = {
  getRecipient: () => recipient ? `${recipient}@s.whatsapp.net` : '',
  onRecipientChange: callback => { onChange = callback },
  addLog: text => {
    state.logs.push({ time: new Date().toISOString(), text })
    if (state.logs.length > 100) state.logs.shift()
  },
  setConnection: connection => {
    state.connection = connection
    if (connection !== 'connecting') { state.qr = null; qrVersion++ }
  },
  setQr: async text => {
    const version = ++qrVersion
    state.qr = null
    state.connection = 'qr'
    try {
      const image = await require('qrcode').toDataURL(text, { width: 300, margin: 2 })
      if (version === qrVersion) state.qr = image
    } catch (err) { module.exports.addLog('Impossible de générer le QR code : ' + err.message) }
  },
  listen: () => {
    if (process.env.RENDER && !process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD est obligatoire sur Render.')
    const host = process.env.ADMIN_PASSWORD ? '0.0.0.0' : '127.0.0.1'
    server.listen(Number(process.env.PORT || 3000), host, () => console.log('Interface web : http://localhost:' + (process.env.PORT || 3000)))
    return server
  }
}
if (require.main === module) {
  module.exports.addLog('Aperçu de l’interface. WhatsApp n’est pas connecté dans ce mode.')
  module.exports.listen()
}
