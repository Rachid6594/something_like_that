const $ = id => document.getElementById(id)
const labels = { idle: 'En attente', connecting: 'Connexion…', qr: 'QR à scanner', connected: 'Connecté', disconnected: 'Déconnecté', error: 'Erreur' }
let initialized = false
async function refresh() {
  try {
    const response = await fetch('/api/status')
    if (!response.ok) throw new Error('Serveur inaccessible')
    const state = await response.json()
    $('status').textContent = labels[state.connection] || state.connection
    $('status').classList.toggle('online', state.connection === 'connected')
    $('qr').hidden = !state.qr
    $('qr-placeholder').hidden = !!state.qr
    if (state.qr) $('qr').src = state.qr
    else $('qr').removeAttribute('src')
    $('qr-message').textContent = state.connection === 'connected' ? 'Ton compte est connecté.' : state.connection === 'error' ? 'Connexion échouée. Consulte l’activité.' : 'Le QR apparaîtra pendant la connexion.'
    if (!initialized) { $('number').value = state.number; initialized = true }
    $('live').textContent = '● Actualisation en direct'
    const rows = state.logs.slice().reverse().map(entry => {
      const row = document.createElement('div')
      row.className = 'log-row'
      const time = document.createElement('time')
      time.textContent = new Date(entry.time).toLocaleTimeString('fr-FR')
      const text = document.createElement('span')
      text.textContent = entry.text
      row.append(time, text)
      return row
    })
    if (rows.length) $('logs').replaceChildren(...rows)
  } catch { $('live').textContent = 'Connexion au serveur interrompue' }
  setTimeout(refresh, 2500)
}
$('config').addEventListener('submit', async event => {
  event.preventDefault()
  $('save').disabled = true
  try {
    const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: $('number').value.trim() }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Enregistrement impossible.')
    $('feedback').textContent = 'Numéro enregistré. Le bot utilise cette destination.'
  } catch (err) { $('feedback').textContent = err.message }
  finally { $('save').disabled = false }
})
refresh()
