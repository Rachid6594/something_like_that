const fs = require('node:fs')
const path = require('node:path')

// DATA_DIR can point to a persistent disk if the hosting plan changes later.
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname
fs.mkdirSync(dataDir, { recursive: true })

module.exports = {
  configPath: path.join(dataDir, 'config.json'),
  authPath: path.join(dataDir, 'auth'),
  logPath: path.join(dataDir, 'bot.log')
}
