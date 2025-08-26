// Robinhood Crypto client stub. Align shapes with official docs when available.
// Provides listOrders(); returns empty results unless LIVE=true and required config is present.

const crypto = require('crypto')
const fetch = require('node-fetch')

const cfg = {
  clientId: process.env.RH_CLIENT_ID,
  apiKey: process.env.RH_API_KEY,
  sharedSecret: process.env.RH_SHARED_SECRET,
  account: process.env.RH_ACCOUNT_NUMBER,
  baseUrl: process.env.RH_BASE_URL || 'https://trading.robinhood.com/api/v1/crypto/',
  live: process.env.LIVE === 'true',
}

function sign({ method, path, body = '' }) {
  // Placeholder signature: replace per official docs
  const ts = Date.now().toString()
  const msg = `${ts}${method}${path}${body}`
  const sig = crypto.createHmac('sha256', cfg.sharedSecret || 'missing').update(msg).digest('base64')
  return { ts, sig }
}

async function http(method, path, data) {
  const body = data ? JSON.stringify(data) : ''
  const { ts, sig } = sign({ method, path, body })
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Robinhood-API-Key': cfg.apiKey || '',
    'X-Robinhood-Client-Id': cfg.clientId || '',
    'X-Robinhood-Signature': sig,
    'X-Robinhood-Timestamp': ts,
  }
  const res = await fetch(url, { method, headers, body: body || undefined })
  if (!res.ok) {
    const txt = await res.text()
    const err = new Error(`HTTP ${res.status}: ${txt}`)
    err.status = res.status
    throw err
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

async function listOrders({ limit = 5 } = {}) {
  // If not live or missing config, return empty list (no mock data)
  const required = [cfg.clientId, cfg.apiKey, cfg.sharedSecret]
  if (!cfg.live || required.some((v) => !v)) {
    return []
  }

  // Replace path and shape per official docs when enabled
  const path = `trading/orders?limit=${encodeURIComponent(limit)}`
  const res = await http('GET', path)
  // Normalize to a basic array shape for Discord
  const items = Array.isArray(res?.results) ? res.results : (Array.isArray(res) ? res : [])
  return items.map((o) => ({
    id: o.id || o.order_id,
    timestamp: o.created_at || o.timestamp,
    side: o.side,
    symbol: o.symbol || o.crypto_symbol,
    quantity: o.quantity || o.notional,
    status: o.status,
  }))
}

module.exports = { listOrders }
