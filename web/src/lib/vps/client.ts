// Centralized VPS API client — all VPS calls go through here
// No more hardcoded VPS_API_URL scattered across 10+ files

const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

async function get(path: string, timeoutMs = 8000): Promise<Response> {
  return fetch(`${VPS_API}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
}

async function post(path: string, body: unknown, timeoutMs = 8000): Promise<Response> {
  return fetch(`${VPS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function put(path: string, body: unknown, timeoutMs = 8000): Promise<Response> {
  return fetch(`${VPS_API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

// Typed VPS API methods
export const vps = {
  // Data sources
  signals: (mode = 'crypto') => get(`/api/signals?mode=${mode}`, 5000),
  news: (limit = 10) => get(`/api/news?limit=${Math.min(limit, 20)}`),
  crucix: () => get('/api/crucix'),
  prices: () => get('/api/prices', 5000),

  // Trades
  trades: (params?: string) => get(`/api/trades${params ? `?${params}` : ''}`),
  tradeStats: () => get('/api/trades/stats'),
  recordTrade: (trade: Record<string, unknown>) => post('/api/trades', trade, 5000),
  recordDecision: (decision: Record<string, unknown>) => post('/api/decisions', decision, 5000),
  recordDecisionBatch: (decisions: unknown[]) => post('/api/decisions/batch', { decisions }, 5000),

  // Strategies
  strategies: (status = 'active') => get(`/api/strategies?status=${status}`, 5000),
  createStrategy: (body: Record<string, unknown>) => post('/api/strategies', body, 5000),
  updateStrategy: (id: number, body: Record<string, unknown>) => put(`/api/strategies/${id}`, body, 5000),

  // Bitget proxy
  bitget: (endpoint: string, method = 'GET', body?: unknown) =>
    method === 'GET'
      ? get(`/api/bitget/${endpoint}`)
      : post(`/api/bitget/${endpoint}`, body, 15000),

  // LiFi
  lifiSwap: (body: Record<string, unknown>) => post('/api/lifi-swap', body, 60000),

  // Sentinel
  sentinelMode: () => get('/api/sentinel-mode', 5000),
  setSentinelMode: (body: Record<string, unknown>) => post('/api/sentinel-mode', body, 5000),
}

export const VPS_BASE_URL = VPS_API
