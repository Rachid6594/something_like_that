const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { spawnSync } = require('node:child_process')

test('Render refuses to expose the dashboard without an admin password', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./server').listen()"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, RENDER: 'true', ADMIN_PASSWORD: '' },
    encoding: 'utf8', timeout: 10000
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ADMIN_PASSWORD est obligatoire/)
})

test('Hosted dashboard protects QR, accepts its HTTPS origin, and persists configuration', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-bot-hosting-'))
  Object.assign(process.env, {
    DATA_DIR: tempDir, PORT: '0', RENDER: 'true',
    RENDER_EXTERNAL_URL: 'https://wa-bot-test.onrender.com',
    PUBLIC_ORIGIN: '', ADMIN_PASSWORD: 'test-password', MY_NUMBER: '22670000000'
  })
  const dashboard = require('../server')
  const server = dashboard.listen()
  try {
    await once(server, 'listening')
    const origin = `http://127.0.0.1:${server.address().port}`
    const headers = { Authorization: 'Basic ' + Buffer.from('admin:test-password').toString('base64') }
    assert.equal((await fetch(origin + '/health')).status, 200)
    assert.equal((await fetch(origin + '/api/status')).status, 401)
    assert.equal((await fetch(origin + '/')).status, 401)
    assert.equal((await fetch(origin + '/', { headers })).status, 200)
    await dashboard.setQr('test-only-not-a-whatsapp-login')
    const status = await (await fetch(origin + '/api/status', { headers })).json()
    assert.equal(status.connection, 'qr')
    assert.match(status.qr, /^data:image\/png;base64,/)
    const post = (number, requestOrigin) => fetch(origin + '/api/config', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Origin: requestOrigin },
      body: JSON.stringify({ number })
    })
    assert.equal((await post('22671111111', 'https://other.example')).status, 403)
    assert.equal((await post('invalid', process.env.RENDER_EXTERNAL_URL)).status, 400)
    let changed
    dashboard.onRecipientChange(value => { changed = value })
    assert.equal((await post('22671111111', process.env.RENDER_EXTERNAL_URL)).status, 200)
    assert.equal(changed, '22671111111@s.whatsapp.net')
    assert.equal(JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf8')).number, '22671111111')
    const restart = spawnSync(process.execPath, ['-e', "process.stdout.write(require('./server').getRecipient())"], {
      cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 10000
    })
    assert.equal(restart.status, 0)
    assert.equal(restart.stdout, '22671111111@s.whatsapp.net')
    dashboard.setConnection('connected')
    const connected = await (await fetch(origin + '/api/status', { headers })).json()
    assert.equal(connected.qr, null)
  } finally {
    await new Promise(resolve => server.close(resolve))
    const configFile = path.join(tempDir, 'config.json')
    if (fs.existsSync(configFile)) fs.unlinkSync(configFile)
    fs.rmdirSync(tempDir)
  }
})
