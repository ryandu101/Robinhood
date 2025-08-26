// Robinhood Crypto client stub. Align shapes with official docs when available.
// Provides listOrders() with mock data unless LIVE=true.

const fetch = require('node-fetch')
const nacl = require('tweetnacl')

const cfg = {
  apiKey: process.env.RH_API_KEY, // x-api-key
  privateKeyB64: process.env.RH_PRIVATE_KEY, // base64 seed (32 bytes)
  account: process.env.RH_ACCOUNT_NUMBER,
  baseUrl: (process.env.RH_BASE_URL || 'https://trading.robinhood.com').replace(/\/+$/, ''),
  live: process.env.LIVE === 'true',
}

function sign({ method, path, bodyStr }) {
  // Per docs: message = f"{api_key}{timestamp}{path}{method}{body}"
  const ts = Math.floor(Date.now() / 1000)
  const body = bodyStr || ''
  const message = `${cfg.apiKey}${ts}${path}${method}${body}`
  // Derive Ed25519 secretKey from 32-byte seed (base64)
  if (!cfg.privateKeyB64) throw new Error('Missing RH_PRIVATE_KEY (base64 seed)')
  const seed = Buffer.from(cfg.privateKeyB64, 'base64')
  if (seed.length !== 32) throw new Error('RH_PRIVATE_KEY must be a 32-byte base64 seed')
  const kp = nacl.sign.keyPair.fromSeed(seed)
  const msgBytes = new TextEncoder().encode(message)
  const sigBytes = nacl.sign.detached(msgBytes, kp.secretKey)
  const signature = Buffer.from(sigBytes).toString('base64')
  return { ts: ts.toString(), signature }
}

async function http(method, path, data) {
  // path must start with /api/v1/...
  if (!path.startsWith('/')) throw new Error('Path must start with /')
  const bodyStr = data ? JSON.stringify(data) : ''
  const { ts, signature } = sign({ method, path, bodyStr })
  const url = cfg.baseUrl + path
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json',
    'x-api-key': cfg.apiKey || '',
    'x-signature': signature,
    'x-timestamp': ts,
  }
  const res = await fetch(url, { method, headers, body: bodyStr || undefined })
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
  if (!cfg.live) {
    // Mock data for testing the bot without live creds
    return Array.from({ length: limit }).map((_, i) => ({
      id: `mock-${i + 1}`,
      timestamp: new Date(Date.now() - i * 3600_000).toISOString(),
      side: i % 2 ? 'sell' : 'buy',
      symbol: i % 2 ? 'ETH' : 'BTC',
      quantity: (0.001 * (i + 1)).toFixed(6),
      status: 'filled',
    }))
  }

  // Replace path and shape per docs when enabled
  const path = `/api/v1/crypto/trading/orders/?limit=${encodeURIComponent(limit)}`
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

// --- Market data helpers (Yahoo Finance free endpoints) ---
// Note: These are for market data only (no auth). For Robinhood trading, replace with official endpoints and auth.

async function getQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Quote HTTP ${res.status}`)
  const data = await res.json()
  const q = data?.quoteResponse?.result?.[0]
  if (!q) throw new Error('No quote data')
  return {
    price: q.regularMarketPrice,
    change: q.regularMarketChange,
    changePercent: q.regularMarketChangePercent,
    prevClose: q.regularMarketPreviousClose,
    open: q.regularMarketOpen,
    dayHigh: q.regularMarketDayHigh,
    dayLow: q.regularMarketDayLow,
    currency: q.currency,
    time: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : undefined,
  }
}

function parseExpiry(expiry) {
  // MM/DD/YY -> YYYY-MM-DD, assume 20YY for YY < 70 else 19YY
  const m = expiry.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (!m) throw new Error('Expiry must be MM/DD/YY')
  let [_, mm, dd, yy] = m
  const year = parseInt(yy, 10)
  const yyyy = year < 70 ? 2000 + year : 1900 + year
  const m2 = String(parseInt(mm, 10)).padStart(2, '0')
  const d2 = String(parseInt(dd, 10)).padStart(2, '0')
  return `${yyyy}-${m2}-${d2}`
}

async function getOptionsSlice(ticker, type, expiry) {
  const expISO = parseExpiry(expiry)
  const t = type.toLowerCase() === 'put' ? 'puts' : 'calls'
  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}?date=${Math.floor(new Date(expISO+'T00:00:00Z').getTime()/1000)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Options HTTP ${res.status}`)
  const data = await res.json()
  const chain = data?.optionChain?.result?.[0]
  if (!chain) throw new Error('No options data')
  const underlying = chain?.quote?.regularMarketPrice
  const contracts = chain?.options?.[0]?.[t]
  if (!contracts || !contracts.length) throw new Error('No contracts found')

  // Find the nearest strike to underlying and pick +/-5 around it
  const sorted = contracts.slice().sort((a, b) => a.strike - b.strike)
  let idx = sorted.findIndex(c => c.strike >= underlying)
  if (idx === -1) idx = sorted.length - 1
  const start = Math.max(0, idx - 5)
  const end = Math.min(sorted.length, idx + 6) // include pivot + 5 above
  const slice = sorted.slice(start, end)

  // Build a simple table
  const header = `${ticker} ${type.toUpperCase()} ${expISO} | Underlying: ${underlying?.toFixed?.(2) ?? underlying}`
  const lines = [header, 'Strike | Bid  Ask  Last  IV   OI   Volume']
  for (const c of slice) {
    const row = [
      (c.strike ?? '').toFixed?.(2) ?? c.strike ?? '',
      (c.bid ?? '').toFixed?.(2) ?? c.bid ?? '',
      (c.ask ?? '').toFixed?.(2) ?? c.ask ?? '',
      (c.lastPrice ?? '').toFixed?.(2) ?? c.lastPrice ?? '',
      (c.impliedVolatility != null ? (c.impliedVolatility * 100).toFixed(1)+'%' : ''),
      c.openInterest ?? '',
      c.volume ?? ''
    ].join(' | ')
    lines.push(row)
  }
  return lines.join('\n')
}

module.exports.getQuote = getQuote
module.exports.getOptionsSlice = getOptionsSlice

// --- Robinhood Crypto Quotes ---
// Requires Read crypto products and Read crypto quotes permissions.
async function getCryptoProductSymbol(base, counter) {
  // Confirm trading pair exists via trading_pairs endpoint
  const symbol = `${base}-${counter}`
  const path = `/api/v1/crypto/trading/trading_pairs/?symbol=${encodeURIComponent(symbol)}`
  const res = await http('GET', path)
  const items = Array.isArray(res?.results) ? res.results : []
  const ok = items.some(p => (p.symbol === symbol))
  if (!ok) throw new Error(`Trading pair not found: ${symbol}`)
  return symbol
}

async function getCryptoQuote(base, counter = 'USD') {
  if (!cfg.apiKey || !cfg.privateKeyB64) {
    throw new Error('Missing Robinhood crypto API env vars (RH_API_KEY, RH_PRIVATE_KEY)')
  }
  // Validate pair exists
  const symbol = await getCryptoProductSymbol(base, counter)
  // Best bid/ask endpoint per docs
  const path = `/api/v1/crypto/marketdata/best_bid_ask/?symbol=${encodeURIComponent(symbol)}`
  const res = await http('GET', path)
  const item = Array.isArray(res?.results) ? res.results[0] : res?.results
  if (!item) throw new Error('No market data returned')
  return {
    price: item?.mid_price ?? undefined,
    bid: item?.bid_price,
    ask: item?.ask_price,
    high: item?.high_price, // if provided; may not exist on this endpoint
    low: item?.low_price,   // if provided; may not exist on this endpoint
    change: item?.change,
    changePercent: item?.change_percent,
    time: item?.as_of || item?.updated_at,
  }
}

module.exports.getCryptoQuote = getCryptoQuote
