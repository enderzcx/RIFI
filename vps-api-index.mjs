import express from 'express';
import { readFileSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { createHash, createHmac } from 'crypto';
import WebSocket from 'ws';
import { createConfig as lifiCreateConfig, getQuote as lifiGetQuote } from '@lifi/sdk';
import { createWalletClient, createPublicClient, http, encodeFunctionData, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, mainnet, bsc } from 'viem/chains';

// --- Env ---
const envLines = readFileSync('.env', 'utf-8').split('\n');
for (const line of envLines) {
  const [k, ...v] = line.split('=');
  if (k && v.length) process.env[k.trim()] = v.join('=').trim();
}

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3200;
const CRUCIX = process.env.CRUCIX_URL || 'http://localhost:3117';
const LLM_BASE = process.env.LLM_BASE_URL || 'http://localhost:8080/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-5.4-mini-low-fast';
const LLM_KEY = process.env.LLM_API_KEY || 'pwd';
const NEWS_TOKEN = process.env.OPENNEWS_TOKEN;
const NEWS_API = 'https://ai.6551.io';
const AUTO_TRADE_URL = process.env.AUTO_TRADE_URL || '';
const AUTO_TRADE_SECRET = process.env.AUTO_TRADE_SECRET || 'rifi-auto-2026';

// --- Bitget CEX ---
const BITGET_API_KEY = process.env.BITGET_API_KEY || '';
const BITGET_SECRET = process.env.BITGET_SECRET_KEY || '';
const BITGET_PASS = process.env.BITGET_PASSPHRASE || '';
const BITGET_BASE = 'https://api.bitget.com';

function bitgetSign(ts, method, path, body = '') {
  const msg = ts + method + path + body;
  return createHmac('sha256', BITGET_SECRET).update(msg).digest('base64');
}

async function bitgetRequest(method, path, body = null) {
  const ts = String(Date.now());
  const bodyStr = body ? JSON.stringify(body) : '';
  const sig = bitgetSign(ts, method, path, bodyStr);
  const res = await fetch(`${BITGET_BASE}${path}`, {
    method,
    headers: {
      'ACCESS-KEY': BITGET_API_KEY,
      'ACCESS-SIGN': sig,
      'ACCESS-TIMESTAMP': ts,
      'ACCESS-PASSPHRASE': BITGET_PASS,
      'Content-Type': 'application/json',
      'locale': 'en-US',
    },
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data.code !== '00000') throw new Error(`Bitget ${data.code}: ${data.msg}`);
  return data.data;
}

async function bitgetPublic(path) {
  const res = await fetch(`${BITGET_BASE}${path}`, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  if (data.code && data.code !== '00000') throw new Error(`Bitget ${data.code}: ${data.msg}`);
  return data.data;
}

// Per-agent model allocation
const AGENT_MODELS = {
  analyst:    process.env.LLM_MODEL_ANALYST    || 'gpt-5.4-mini',
  risk:       process.env.LLM_MODEL_RISK       || 'gpt-5.4-mini',
  strategist: process.env.LLM_MODEL_STRATEGIST || 'gpt-5.4-mini',
  executor:   process.env.LLM_MODEL_EXECUTOR   || 'gpt-5.4-mini-low-fast',
  reviewer:   process.env.LLM_MODEL_REVIEWER   || 'gpt-5.4-mini',
};

// --- LiFi Cross-Chain ---

const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const SESSION_MANAGER_V2 = '0x342168e8D2BF8315BbF72F409A94f1EC7570f611';

const CHAIN_MAP = { base: 8453, ethereum: 1, bsc: 56 };
const CHAIN_OBJECTS = { 8453: base, 1: mainnet, 56: bsc };

const TOKEN_REGISTRY = {
  'USDC:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'USDC:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'USDC:56': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  'WETH:8453': '0x4200000000000000000000000000000000000006',
  'WETH:1': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  'ETH:8453': '0x0000000000000000000000000000000000000000',
  'ETH:1': '0x0000000000000000000000000000000000000000',
  'BNB:56': '0x0000000000000000000000000000000000000000',
  // Ondo GM tokens — BSC (primary, cheap gas)
  'AAPLon:56': '0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4',
  'NVDAon:56': '0xa9ee28c80f960b889dfbd1902055218cba016f75',
  'TSLAon:56': '0x2494b603319d4d9f9715c9f4496d9e0364b59d93',
  'SPYon:56':  '0x6a708ead771238919d85930b5a0f10454e1c331a',
  // Ondo GM tokens — Ethereum (expensive gas, backup)
  'AAPLon:1': 'placeholder',
  'NVDAon:1': 'placeholder',
  'SPYon:1': 'placeholder',
};

const SM_V2_ABI = [
  { type: 'function', name: 'executeCall', inputs: [{ name: 'user', type: 'address' }, { name: 'target', type: 'address' }, { name: 'spendAmount', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [{ name: 'result', type: 'bytes' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'canExecute', inputs: [{ name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: 'ok', type: 'bool' }, { name: 'reason', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'isAllowedTarget', inputs: [{ name: 'target', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
];

function resolveToken(symbol, chainId) {
  // If it's already an address, return as-is
  if (symbol.startsWith('0x') && symbol.length === 42) return symbol;
  // Try exact match first (for case-sensitive tokens like AAPLon), then uppercase
  return TOKEN_REGISTRY[`${symbol}:${chainId}`] || TOKEN_REGISTRY[`${symbol.toUpperCase()}:${chainId}`] || null;
}

// Initialize LiFi SDK
let lifiReady = false;
try {
  const pk = process.env.PRIVATE_KEY || readFileSync('.env', 'utf-8').split('\n').find(l => l.startsWith('PRIVATE_KEY'))?.split('=')[1]?.trim();
  if (pk) {
    lifiCreateConfig({ integrator: 'RIFI' });
    lifiReady = true;
    console.log('[LiFi] SDK initialized');
  }
} catch (e) { console.warn('[LiFi] Init failed:', e.message); }

async function lifiSwap({ fromChain, toChain, fromToken, toToken, amount, userAddress }) {
  if (!lifiReady) throw new Error('LiFi SDK not initialized');

  const fromChainId = CHAIN_MAP[fromChain] || parseInt(fromChain);
  const toChainId = CHAIN_MAP[toChain] || parseInt(toChain);
  const fromTokenAddr = resolveToken(fromToken, fromChainId);
  const toTokenAddr = resolveToken(toToken, toChainId);

  if (!fromTokenAddr) throw new Error(`Unknown token: ${fromToken} on ${fromChain}`);
  if (!toTokenAddr || toTokenAddr === 'placeholder') throw new Error(`Unknown/placeholder token: ${toToken} on ${toChain}`);

  // Determine decimals (USDC=6, most others=18)
  const decimals = fromToken.toUpperCase().includes('USDC') ? 6 : 18;
  const fromAmount = parseUnits(amount, decimals).toString();

  console.log(`[LiFi] Quote: ${amount} ${fromToken} (${fromChain}) → ${toToken} (${toChain})`);

  const quote = await lifiGetQuote({
    fromChain: fromChainId,
    toChain: toChainId,
    fromToken: fromTokenAddr,
    toToken: toTokenAddr,
    fromAmount,
    fromAddress: userAddress || SESSION_MANAGER_V2,
  });

  return {
    quote,
    fromChainId,
    toChainId,
    fromAmount,
    estimatedOutput: quote.estimate?.toAmount || '0',
    estimatedOutputFormatted: quote.estimate?.toAmountMin ? formatUnits(BigInt(quote.estimate.toAmountMin), quote.action?.toToken?.decimals || 18) : '?',
    tool: quote.toolDetails?.name || 'lifi',
    transactionRequest: quote.transactionRequest,
  };
}

// --- SQLite ---
mkdirSync('data', { recursive: true });
const db = new Database('data/rifi.db');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    summary TEXT,
    source TEXT,
    link TEXT,
    score REAL,
    signal TEXT,
    link_hash TEXT UNIQUE,
    fetched_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL DEFAULT 'crypto',
    result_json TEXT,
    macro_risk_score INTEGER,
    crypto_sentiment INTEGER,
    stock_sentiment INTEGER,
    technical_bias TEXT,
    recommended_action TEXT,
    confidence INTEGER,
    push_worthy INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS patrol_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL DEFAULT 'crypto',
    report_text TEXT,
    period TEXT,
    scans INTEGER,
    risk_range TEXT,
    sentiment_range TEXT,
    trades_executed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT UNIQUE,
    source TEXT DEFAULT 'onchain',
    pair TEXT,
    side TEXT,
    entry_price REAL,
    exit_price REAL,
    amount REAL,
    amount_out REAL,
    pnl REAL,
    pnl_pct REAL,
    fee REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    tx_hash TEXT,
    signal_snapshot TEXT,
    decision_reasoning TEXT,
    opened_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    agent TEXT DEFAULT 'sentinel',
    action TEXT,
    tool_name TEXT,
    tool_args TEXT,
    tool_result TEXT,
    input_summary TEXT,
    output_summary TEXT,
    reasoning TEXT,
    confidence INTEGER,
    result_eval TEXT DEFAULT 'pending',
    trade_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_news_fetched ON news(fetched_at);
  CREATE INDEX IF NOT EXISTS idx_analysis_mode ON analysis(mode, created_at);
  CREATE INDEX IF NOT EXISTS idx_patrol_mode ON patrol_reports(mode, created_at);
  CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status, opened_at);
  CREATE INDEX IF NOT EXISTS idx_trades_id ON trades(trade_id);
  CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(timestamp);
  CREATE INDEX IF NOT EXISTS idx_decisions_trade ON decisions(trade_id);

  CREATE TABLE IF NOT EXISTS agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT,
    from_agent TEXT,
    to_agent TEXT,
    type TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_msg_trace ON agent_messages(trace_id);

  CREATE TABLE IF NOT EXISTS strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal TEXT,
    template TEXT DEFAULT 'custom',
    plan_json TEXT,
    params_json TEXT,
    status TEXT DEFAULT 'active',
    progress_pct REAL DEFAULT 0,
    score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status);

  CREATE TABLE IF NOT EXISTS candles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    ts_start TEXT NOT NULL,
    UNIQUE(pair, ts_start)
  );
  CREATE INDEX IF NOT EXISTS idx_candles_pair_ts ON candles(pair, ts_start);

  CREATE TABLE IF NOT EXISTS signal_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL UNIQUE,
    recommended_action TEXT,
    confidence INTEGER,
    price_at_signal REAL,
    price_15m REAL,
    price_1h REAL,
    price_4h REAL,
    correct_15m INTEGER,
    correct_1h INTEGER,
    correct_4h INTEGER,
    scored_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_signal_scores_action ON signal_scores(recommended_action);

  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT DEFAULT 'reviewer',
    lesson TEXT NOT NULL,
    category TEXT,
    confidence INTEGER DEFAULT 50,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_lessons_active ON lessons(active, created_at);

  CREATE TABLE IF NOT EXISTS source_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT NOT NULL,
    period TEXT NOT NULL,
    total_signals INTEGER DEFAULT 0,
    correct_signals INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0,
    weight REAL DEFAULT 1.0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_name, period)
  );
`);

const insertNews = db.prepare(`
  INSERT OR IGNORE INTO news (title, summary, source, link, score, signal, link_hash, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertAnalysis = db.prepare(`
  INSERT INTO analysis (mode, result_json, macro_risk_score, crypto_sentiment, stock_sentiment, technical_bias, recommended_action, confidence, push_worthy, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTrade = db.prepare(`
  INSERT INTO trades (trade_id, source, pair, side, entry_price, amount, amount_out, status, tx_hash, signal_snapshot, decision_reasoning, opened_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateTradeClose = db.prepare(`
  UPDATE trades SET exit_price = ?, pnl = ?, pnl_pct = ?, status = 'closed', closed_at = ? WHERE trade_id = ?
`);
const insertDecision = db.prepare(`
  INSERT INTO decisions (timestamp, agent, action, tool_name, tool_args, tool_result, input_summary, output_summary, reasoning, confidence, trade_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertPatrol = db.prepare(`
  INSERT INTO patrol_reports (mode, report_text, period, scans, risk_range, sentiment_range, trades_executed, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

function persistNews(newsArr) {
  const now = new Date().toISOString();
  const insert = db.transaction((items) => {
    for (const n of items) {
      const link = n.link || n.url || '';
      const hash = link ? createHash('md5').update(link).digest('hex') : createHash('md5').update(n.title || '' + n.source || '').digest('hex');
      insertNews.run(
        n.title || n.headline || '',
        n.summary || n.description || '',
        n.source || '',
        link,
        n.score || n.aiRating?.score || 0,
        n.signal || n.aiRating?.signal || 'neutral',
        hash,
        now
      );
    }
  });
  try { insert(newsArr); } catch (e) { console.error('[DB] News insert error:', e.message); }
}

function persistAnalysis(mode, parsed, now) {
  try {
    insertAnalysis.run(
      mode,
      JSON.stringify(parsed),
      parsed.macro_risk_score || 0,
      parsed.crypto_sentiment || 0,
      parsed.stock_sentiment || 0,
      parsed.technical_bias || 'neutral',
      parsed.recommended_action || 'hold',
      parsed.confidence || 0,
      parsed.push_worthy ? 1 : 0,
      now
    );
  } catch (e) { console.error('[DB] Analysis insert error:', e.message); }
}

function persistPatrol(mode, report, period, scans, riskRange, sentRange, trades, now) {
  try {
    insertPatrol.run(mode, report, period, scans, riskRange, sentRange, trades, now);
  } catch (e) { console.error('[DB] Patrol insert error:', e.message); }
}

// --- Dual Mode Cache ---
const cache = {
  crypto: { analysis: null, lastUpdate: null, analyzing: false, patrolHistory: [], patrolCounter: 0 },
  stock:  { analysis: null, lastUpdate: null, analyzing: false, patrolHistory: [], patrolCounter: 0 },
};
const PATROL_INTERVAL = 12; // 12 * 15min = 3h

// --- Data Sources ---

async function fetchCrucix() {
  try {
    const res = await fetch(`${CRUCIX}/api/data`, { signal: AbortSignal.timeout(10000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function fetchNews(limit = 15) {
  if (!NEWS_TOKEN) return [];
  try {
    const res = await fetch(`${NEWS_API}/open/news_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NEWS_TOKEN}` },
      body: JSON.stringify({ limit, min_score: 50 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || data || [];
  } catch { return []; }
}

// --- OKX WebSocket Price Streaming ---

const PRICE_PAIRS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];
const priceCache = {}; // { 'BTC-USDT': { price, ts, high5m, low5m, change5m, history[] } }
const ANOMALY_THRESHOLD = 0.02;  // 2% in 5min → instant analysis
const FLASH_THRESHOLD = 0.05;    // 5% in 5min → FLASH alert
const PRICE_WINDOW = 5 * 60 * 1000; // 5 min
let wsConnected = false;
let wsReconnectTimer = null;

function initPriceCache() {
  for (const pair of PRICE_PAIRS) {
    priceCache[pair] = { price: 0, ts: 0, change5m: 0, high5m: 0, low5m: 0, history: [] };
  }
}
initPriceCache();

// --- Candle Buffer (5-min OHLCV) ---
const CANDLE_INTERVAL = 5 * 60 * 1000; // 5 min
const candleBuffer = {}; // { 'BTC-USDT': { open, high, low, close, ts_start } }
const insertCandle = db.prepare(`
  INSERT OR REPLACE INTO candles (pair, open, high, low, close, ts_start)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function getCandleBucket(ts) {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5);
  return d.toISOString();
}

function flushCandle(pair) {
  const candle = candleBuffer[pair];
  if (!candle || !candle.open) return;
  try {
    insertCandle.run(pair, candle.open, candle.high, candle.low, candle.close, candle.ts_start);
  } catch {}
}

function updateCandle(pair, price, ts) {
  const bucket = getCandleBucket(ts);
  const existing = candleBuffer[pair];
  if (!existing || existing.ts_start !== bucket) {
    // New bucket — flush previous candle and start fresh
    if (existing) flushCandle(pair);
    candleBuffer[pair] = { open: price, high: price, low: price, close: price, ts_start: bucket };
  } else {
    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
  }
}

// Safety flush every 60s (handles low-activity periods)
setInterval(() => {
  for (const pair of PRICE_PAIRS) {
    if (candleBuffer[pair]) flushCandle(pair);
  }
}, 60000);

function updatePrice(pair, price, ts) {
  const c = priceCache[pair];
  if (!c) return;
  c.price = price;
  c.ts = ts;
  c.history.push({ price, ts });

  // Trim history to 5min window
  const cutoff = ts - PRICE_WINDOW;
  while (c.history.length > 0 && c.history[0].ts < cutoff) c.history.shift();

  if (c.history.length > 1) {
    const oldest = c.history[0].price;
    c.change5m = (price - oldest) / oldest;
    c.high5m = Math.max(...c.history.map(h => h.price));
    c.low5m = Math.min(...c.history.map(h => h.price));
  }

  // Feed candle buffer
  updateCandle(pair, price, ts);
}

function checkPriceAnomaly(pair) {
  const c = priceCache[pair];
  if (!c || c.history.length < 2) return null;
  const absChange = Math.abs(c.change5m);
  if (absChange >= FLASH_THRESHOLD) return { pair, level: 'FLASH', change: c.change5m, price: c.price };
  if (absChange >= ANOMALY_THRESHOLD) return { pair, level: 'PRIORITY', change: c.change5m, price: c.price };
  return null;
}

// Cooldown: don't trigger analysis more than once per 3 min per pair
const anomalyCooldowns = {};

function handleAnomaly(anomaly) {
  const now = Date.now();
  const key = anomaly.pair;
  if (anomalyCooldowns[key] && now - anomalyCooldowns[key] < 3 * 60 * 1000) return;
  anomalyCooldowns[key] = now;

  const direction = anomaly.change > 0 ? 'up' : 'down';
  const pctStr = (anomaly.change * 100).toFixed(2);
  console.log(`[PriceAlert:${anomaly.level}] ${anomaly.pair} ${direction} ${pctStr}% in 5min → $${anomaly.price}`);

  // Trigger instant analysis
  (async () => {
    const [crucix, news] = await Promise.all([fetchCrucix(), fetchNews()]);
    await runFullAnalysis('crypto', crucix, news);
  })().catch(err => console.error('[PriceAlert] Analysis error:', err.message));
}

function connectOKXWebSocket() {
  const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');

  ws.on('open', () => {
    wsConnected = true;
    console.log('[OKX-WS] Connected');
    // Subscribe to tickers
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: PRICE_PAIRS.map(pair => ({ channel: 'tickers', instId: pair })),
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.data && Array.isArray(msg.data)) {
        for (const tick of msg.data) {
          const pair = tick.instId;
          const price = parseFloat(tick.last);
          const ts = parseInt(tick.ts) || Date.now();
          if (pair && price > 0) {
            updatePrice(pair, price, ts);
            const anomaly = checkPriceAnomaly(pair);
            if (anomaly) handleAnomaly(anomaly);
          }
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    wsConnected = false;
    console.log('[OKX-WS] Disconnected, reconnecting in 5s...');
    wsReconnectTimer = setTimeout(connectOKXWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('[OKX-WS] Error:', err.message);
    ws.close();
  });

  // Ping every 25s to keep alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    else clearInterval(pingInterval);
  }, 25000);
}

// --- LLM Call ---

async function llm(messages, opts = {}) {
  const start = Date.now();
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: opts.model || LLM_MODEL,
      messages,
      max_tokens: opts.max_tokens || 800,
      temperature: opts.temperature || 0.3,
    }),
    signal: AbortSignal.timeout(opts.timeout || 30000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = await res.json();
  const usage = data.usage || {};
  return {
    content: data.choices?.[0]?.message?.content || '',
    duration_s: Number(((Date.now() - start) / 1000).toFixed(1)),
    model: data.model || LLM_MODEL,
    tokens: { prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0, total: usage.total_tokens || 0 },
  };
}

// --- Agent Infrastructure ---

const insertAgentMsg = db.prepare(`
  INSERT INTO agent_messages (trace_id, from_agent, to_agent, type, payload, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const agentMessages = []; // in-memory bus: { from, to, type, payload, trace_id, ts }

function postMessage(from, to, type, payload, traceId) {
  const msg = { from, to, type, payload, trace_id: traceId, ts: Date.now() };
  agentMessages.push(msg);
  if (agentMessages.length > 500) agentMessages.splice(0, agentMessages.length - 500);
  try { insertAgentMsg.run(traceId, from, to, type, JSON.stringify(payload), new Date().toISOString()); } catch {}
  return msg;
}

function getMessages(to, traceId) {
  return agentMessages.filter(m => m.to === to && (!traceId || m.trace_id === traceId));
}

// --- Agent Metrics ---
const agentMetrics = {}; // { analyst: { calls: 0, errors: 0, total_ms: 0, total_tokens: 0, last_run: null } }
function recordMetric(agent, durationMs, tokens, error = false) {
  if (!agentMetrics[agent]) agentMetrics[agent] = { calls: 0, errors: 0, total_ms: 0, total_tokens: 0, last_run: null };
  const m = agentMetrics[agent];
  m.calls++;
  if (error) m.errors++;
  m.total_ms += durationMs;
  m.total_tokens += tokens;
  m.last_run = new Date().toISOString();
}

/**
 * Run an agent: LLM with tool-calling loop.
 * @param {string} agentName - e.g. 'analyst', 'risk', 'strategist', 'reviewer'
 * @param {string} systemPrompt
 * @param {{ type: string, function: { name: string, description: string, parameters: object } }[]} agentTools - OpenAI tool defs
 * @param {Record<string, (args: object) => Promise<string>>} toolExecutors - { toolName: fn(args) => resultString }
 * @param {string} userMessage
 * @param {{ trace_id?: string, max_rounds?: number, max_tokens?: number }} opts
 * @returns {Promise<{ content: string, toolCalls: { name: string, args: object, result: string }[], trace_id: string }>}
 */
async function runAgent(agentName, systemPrompt, agentTools, toolExecutors, userMessage, opts = {}) {
  const traceId = opts.trace_id || `${agentName}_${Date.now()}`;
  const maxRounds = opts.max_rounds || 5;
  const agentStart = Date.now();
  let totalTokens = 0;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  const allToolCalls = [];

  const agentModel = opts.model || AGENT_MODELS[agentName] || LLM_MODEL;

  try {
  for (let round = 0; round < maxRounds; round++) {
    const reqBody = {
      model: agentModel,
      messages,
      max_tokens: opts.max_tokens || 800,
      temperature: 0.3,
    };
    if (agentTools.length > 0) {
      reqBody.tools = agentTools;
      reqBody.tool_choice = 'auto';
    }

    const start = Date.now();
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(opts.timeout || 30000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('No message in LLM response');
    totalTokens += data.usage?.total_tokens || 0;

    messages.push(msg);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // No tool calls → done
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const totalMs = Date.now() - agentStart;
      console.log(`[Agent:${agentName}] Done in ${round + 1} round(s), ${elapsed}s, ${totalTokens}tok [${agentModel}]`);
      recordMetric(agentName, totalMs, totalTokens);
      return { content: msg.content || '', toolCalls: allToolCalls, trace_id: traceId };
    }

    // Execute tool calls
    for (const tc of msg.tool_calls) {
      const fnName = tc.function.name;
      const args = JSON.parse(tc.function.arguments || '{}');
      const executor = toolExecutors[fnName];
      let result;
      if (executor) {
        try { result = await executor(args); } catch (e) { result = JSON.stringify({ error: e.message }); }
      } else {
        result = JSON.stringify({ error: `Unknown tool: ${fnName}` });
      }

      allToolCalls.push({ name: fnName, args, result });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result) });

      // Record to decisions table
      try {
        insertDecision.run(
          new Date().toISOString(), agentName, 'tool_call',
          fnName, JSON.stringify(args), typeof result === 'string' ? result : JSON.stringify(result),
          '', '', '', 0, opts.trade_id || null
        );
      } catch {}
    }
  }

  // Max rounds reached
  const lastContent = messages[messages.length - 1]?.content || '';
  recordMetric(agentName, Date.now() - agentStart, totalTokens);
  return { content: lastContent, toolCalls: allToolCalls, trace_id: traceId };

  } catch (err) {
    recordMetric(agentName, Date.now() - agentStart, totalTokens, true);
    throw err;
  }
}

// --- AI Analysis ---

// --- Analyst Agent ---

function buildAnalystSystemPrompt(mode) {
  const roleLabel = mode === 'stock' ? 'senior US equity market intelligence analyst' : 'senior crypto trading intelligence analyst';
  const focusLabel = mode === 'stock'
    ? 'US stock market conditions. Focus on S&P500, VIX, sector rotation, rate expectations, geopolitical impact on equities.'
    : 'crypto market conditions. Focus on BTC, ETH, macro risk, on-chain signals, and sentiment.';
  const sentimentField = mode === 'stock' ? '"stock_sentiment"' : '"crypto_sentiment"';
  const pushRule = mode === 'stock'
    ? 'VIX spike >25, S&P500 drop >2%, major Fed action, geopolitical escalation'
    : 'VIX spike, major hack, regulation news, 5%+ price move';

  // Dynamic lesson injection from learning loop
  let lessonsBlock = '';
  try {
    const activeLessons = db.prepare('SELECT lesson, category FROM lessons WHERE active = 1 ORDER BY created_at DESC LIMIT 10').all();
    if (activeLessons.length > 0) {
      lessonsBlock = `\n\nLessons from past performance (apply these to your analysis):\n${activeLessons.map(l => `- [${l.category}] ${l.lesson}`).join('\n')}`;
    }
  } catch {}

  // Performance-based mode adjustment
  let performanceBlock = '';
  try {
    const closed = db.prepare('SELECT pnl FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT 20').all('closed');
    const wins = closed.filter(t => t.pnl > 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) : 0.5;
    let consecutiveLosses = 0;
    for (const t of closed) { if (t.pnl <= 0) consecutiveLosses++; else break; }
    if (consecutiveLosses >= 3 || winRate < 0.35) {
      performanceBlock = `\n\n⚠️ PERFORMANCE WARNING: Win rate ${(winRate * 100).toFixed(0)}%, ${consecutiveLosses} consecutive losses. Switch to CONSERVATIVE mode: only recommend action if confidence > 75. Prefer "hold" over marginal setups.`;
    } else if (winRate > 0.6) {
      performanceBlock = `\n\nPerformance is strong (${(winRate * 100).toFixed(0)}% win rate). Maintain current approach.`;
    }
  } catch {}

  return `You are a ${roleLabel}. You have tools to fetch real-time data. ALWAYS use multiple data sources before making a decision.

Your workflow:
1. Call get_crucix_data for macro/market data (VIX, S&P500, gold, geopolitics)
2. Call get_crypto_news for AI-scored news sentiment
3. Call get_prices for real-time prices + 5min change
4. Call get_technical_indicators for BTC (and ETH if crypto mode) — this gives you EMA, RSI, MACD, ATR, Bollinger, Fib 0.31, OI, funding rate
5. Call get_trade_performance to see recent win rate and calibrate your confidence
6. Synthesize ALL data into your analysis

KEY ANALYSIS FRAMEWORK (5 dimensions, score each):
- Macro (20%): VIX, dollar, geopolitics, Fed policy
- Technical (30%): EMA20 trend, RSI oversold/overbought, MACD cross, Bollinger position
- News/Sentiment (20%): AI-scored news direction + relevance
- On-chain/OI (15%): Open Interest trend vs price (divergence = reversal signal), funding rate extreme
- Fib 0.31 (15%): Price proximity to 0.31 level — this is a high-precision S/R level

CRITICAL RULES for 0.31 and OI:
- Fib 0.31: Price approaching 0.31 from below = strong resistance (expect pullback, prepare short). Price approaching 0.31 from above = strong support (expect bounce, prepare long). Most precise on 1H/4H.
- OI interpretation:
  * Price UP + OI DOWN = bullish divergence (go-live rally, shorts liquidated)
  * Price UP + OI UP = leverage piling, potential trap (caution)
  * Price DOWN + OI UP = bears adding, bearish continuation
  * Price DOWN + OI DOWN = deleveraging, potential bottom forming
- Funding rate > 0.03% = longs overcrowded (bearish). Funding < -0.01% = shorts crowded (bullish squeeze potential).

PROACTIVE TRADING — you are NOT passive:
- If technical setup is clear (RSI extreme + EMA support/resistance + OI confirms), recommend action even without FLASH news
- Include specific entry_zone, stop_loss, take_profit in your output
- SL:TP ratio must be >= 1:2 (risk $1 to make $2+)
- Left-side entries preferred: buy at support BEFORE confirmation, not after breakout

Produce a JSON object with these exact fields:
{
  "macro_risk_score": <0-100, higher = more risk>,
  ${sentimentField}: <0-100, higher = more bullish>,
  "technical_bias": "long" | "short" | "neutral",
  "recommended_action": "strong_buy" | "increase_exposure" | "hold" | "reduce_exposure" | "strong_sell",
  "confidence": <0-100>,
  "entry_zone": { "low": <price>, "high": <price> },
  "stop_loss": <price or null>,
  "take_profit": <price or null>,
  "alerts": [
    { "level": "FLASH|PRIORITY|ROUTINE", "signal": "<one-line Chinese description>", "source": "<data source>", "relevance": <0-100> }
  ],
  "briefing": "<3-4 sentence Chinese briefing. ${focusLabel} Include specific prices, key indicator values (RSI, EMA, OI trend), and the reasoning chain. Be actionable.>",
  "push_worthy": <true if confidence >= 65 AND action is not hold>,
  "push_reason": "<if push_worthy, one-line Chinese reason>",
  "key_levels": { "support": <price>, "resistance": <price>, "fib_031": <price> }
}

Rules:
- alerts: max 6, sorted by relevance desc.
- briefing: Chinese only, no markdown. Include specific prices/indicator values.
- push_worthy: true when confidence >= 65 AND recommended_action is NOT hold (be more proactive!)
- IMPORTANT: push_worthy was previously too conservative. If technical + macro align with confidence > 65, push it.
- Be precise with numbers
- Output ONLY the JSON after gathering data, no other text.${lessonsBlock}${performanceBlock}`;
}

const ANALYST_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_crucix_data',
      description: 'Fetch macro & market data from Crucix 27-source OSINT engine (VIX, BTC, ETH, S&P500, gold, energy, conflicts, weather, TG urgent)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_crypto_news',
      description: 'Fetch latest AI-scored crypto/finance news with sentiment signals',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Number of news items (default 10, max 15)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_prices',
      description: 'Get real-time prices from OKX WebSocket for BTC-USDT, ETH-USDT, SOL-USDT with 5-minute change data',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_technical_indicators',
      description: 'Fetch technical indicators for BTC and ETH from Bitget: 1H and 4H candles with EMA20, RSI(7/14), MACD, ATR, Bollinger Bands, Fibonacci 0.31 level, support/resistance, and Open Interest + funding rate. Essential for precise entry/exit timing.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol (default: BTCUSDT). Options: BTCUSDT, ETHUSDT, SOLUSDT', enum: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trade_performance',
      description: 'Get recent trading performance: win rate, PnL, consecutive losses, recent trades. Use this to calibrate confidence and aggressiveness.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const ANALYST_EXECUTORS = {
  get_crucix_data: async () => {
    const data = await fetchCrucix();
    return data ? JSON.stringify(compactCrucixObj(data)) : JSON.stringify({ error: 'Crucix unavailable' });
  },
  get_crypto_news: async (args) => {
    const news = await fetchNews(args.limit || 10);
    if (!news.length) return JSON.stringify({ news: [] });
    return JSON.stringify(news.slice(0, 15).map(n => ({
      title: (n.title || n.headline || '').slice(0, 120),
      score: n.score || n.aiRating?.score || 0,
      signal: n.signal || n.aiRating?.signal || 'neutral',
      source: n.source || '?',
    })));
  },
  get_prices: async () => {
    const prices = {};
    for (const pair of PRICE_PAIRS) {
      const c = priceCache[pair];
      prices[pair] = { price: c.price, change5m: (c.change5m * 100).toFixed(2) + '%', high5m: c.high5m, low5m: c.low5m };
    }
    return JSON.stringify(prices);
  },
  get_technical_indicators: async (args) => {
    const symbol = args.symbol || 'BTCUSDT';
    try {
      // Fetch 1H and 4H candles in parallel
      const [candles1h, candles4h, oiData, tickerData] = await Promise.all([
        bitgetPublic(`/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=1H&limit=100`),
        bitgetPublic(`/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=4H&limit=50`),
        bitgetPublic(`/api/v2/mix/market/open-interest?symbol=${symbol}&productType=USDT-FUTURES`).catch(() => null),
        bitgetPublic(`/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`).catch(() => null),
      ]);

      const parse1h = parseCandles(candles1h);
      const parse4h = parseCandles(candles4h);

      // Compute indicators for 1H
      const tech1h = computeIndicators(parse1h, '1H');
      // Compute indicators for 4H
      const tech4h = computeIndicators(parse4h, '4H');

      // Open Interest (API returns array)
      const oiObj = Array.isArray(oiData) ? oiData[0] : oiData;
      const oi = oiObj ? {
        amount: oiObj.openInterest || oiObj.amount,
        value_usd: oiObj.openInterestUsd || oiObj.value,
      } : null;

      // Funding rate from ticker
      const ticker = Array.isArray(tickerData) ? tickerData[0] : tickerData;
      const fundingRate = ticker?.fundingRate ? parseFloat(ticker.fundingRate) : null;

      return JSON.stringify({
        symbol,
        '1H': tech1h,
        '4H': tech4h,
        open_interest: oi,
        funding_rate: fundingRate,
        funding_rate_pct: fundingRate ? (fundingRate * 100).toFixed(4) + '%' : null,
      });
    } catch (err) {
      return JSON.stringify({ error: `Tech indicators failed: ${err.message}` });
    }
  },
  get_trade_performance: async () => {
    try {
      const closed = db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT 20').all('closed');
      const wins = closed.filter(t => t.pnl > 0);
      const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
      let consecutiveLosses = 0;
      for (const t of closed) { if (t.pnl <= 0) consecutiveLosses++; else break; }
      const avgWinPnl = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
      const losses = closed.filter(t => t.pnl <= 0);
      const avgLossPnl = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
      return JSON.stringify({
        total_closed: closed.length,
        wins: wins.length,
        win_rate: closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) + '%' : 'N/A',
        total_pnl: totalPnl.toFixed(4),
        avg_win: avgWinPnl.toFixed(4),
        avg_loss: avgLossPnl.toFixed(4),
        profit_factor: avgLossPnl !== 0 ? Math.abs(avgWinPnl / avgLossPnl).toFixed(2) : 'N/A',
        consecutive_losses: consecutiveLosses,
        recent_5: closed.slice(0, 5).map(t => ({ pair: t.pair, side: t.side, pnl: t.pnl, closed_at: t.closed_at })),
        guidance: consecutiveLosses >= 3 ? 'CONSERVATIVE: 3+ consecutive losses, reduce position size and only take high-confidence setups'
          : wins.length / Math.max(closed.length, 1) < 0.4 ? 'CAUTIOUS: win rate below 40%, tighten entry criteria'
          : 'NORMAL: performance acceptable',
      });
    } catch { return JSON.stringify({ error: 'Trade stats unavailable' }); }
  },
};

// --- Technical indicator computation helpers ---

function parseCandles(raw) {
  if (!raw?.length) return { closes: [], highs: [], lows: [], opens: [], volumes: [] };
  // Bitget candle format: [ts, open, high, low, close, vol, quoteVol]
  const sorted = [...raw].reverse(); // oldest first
  return {
    closes: sorted.map(k => parseFloat(k[4])),
    highs: sorted.map(k => parseFloat(k[2])),
    lows: sorted.map(k => parseFloat(k[3])),
    opens: sorted.map(k => parseFloat(k[1])),
    volumes: sorted.map(k => parseFloat(k[5])),
  };
}

function computeIndicators(data, timeframe) {
  const { closes, highs, lows } = data;
  if (closes.length < 20) return { error: 'Insufficient data' };

  const price = closes[closes.length - 1];

  // EMA20
  const ema20 = calcEMA(closes, 20);
  // RSI (7 short-term + 14 standard)
  const rsi7 = calcRSI(closes, 7);
  const rsi14 = calcRSI(closes, 14);
  // MACD (12, 26, 9)
  const macd = calcMACD(closes);
  // ATR (14)
  const atr = calcATR(highs, lows, closes, 14);
  // Bollinger Bands
  const bb = calcBollinger(closes, 20);
  // Support & Resistance (20-bar)
  const support = Math.min(...lows.slice(-20));
  const resistance = Math.max(...highs.slice(-20));
  // Fibonacci 0.31 level (from recent swing low to high)
  const swingLow = Math.min(...lows.slice(-50));
  const swingHigh = Math.max(...highs.slice(-50));
  const fib031_resistance = swingLow + (swingHigh - swingLow) * 0.31; // from bottom
  const fib031_support = swingHigh - (swingHigh - swingLow) * 0.31;   // from top

  return {
    timeframe,
    price,
    ema20,
    price_vs_ema20: price > ema20 ? 'above' : 'below',
    rsi7,
    rsi14,
    rsi_signal: rsi14 < 30 ? 'OVERSOLD' : rsi14 > 70 ? 'OVERBOUGHT' : rsi7 < 25 ? 'SHORT_TERM_OVERSOLD' : rsi7 > 75 ? 'SHORT_TERM_OVERBOUGHT' : 'NEUTRAL',
    macd_line: macd.macd,
    macd_signal: macd.signal,
    macd_histogram: macd.histogram,
    macd_cross: macd.histogram > 0 && macd.prevHistogram <= 0 ? 'BULLISH_CROSS' : macd.histogram < 0 && macd.prevHistogram >= 0 ? 'BEARISH_CROSS' : 'NONE',
    atr,
    atr_pct: ((atr / price) * 100).toFixed(2) + '%',
    bollinger: bb,
    bb_position: bb ? (price > bb.upper ? 'ABOVE_UPPER' : price < bb.lower ? 'BELOW_LOWER' : 'IN_BAND') : null,
    support,
    resistance,
    fib_031: {
      from_bottom: +fib031_resistance.toFixed(2),
      from_top: +fib031_support.toFixed(2),
      note: 'The 0.31 Fibonacci level is a high-precision support/resistance. Price touching 0.31 from below = strong resistance (expect pullback). Price touching 0.31 from above = strong support (expect bounce).',
    },
  };
}

function calcEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return +ema.toFixed(2);
}

function calcMACD(closes) {
  const ema12 = calcEMAArray(closes, 12);
  const ema26 = calcEMAArray(closes, 26);
  if (!ema12 || !ema26) return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
  // Only use MACD values from index 26+ where EMA26 is meaningful
  const macdLine = ema12.slice(26).map((v, i) => v - ema26[i + 26]);
  if (macdLine.length < 9) return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
  const signalLine = calcEMAArray(macdLine, 9);
  if (!signalLine) return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
  const last = macdLine.length - 1;
  return {
    macd: +macdLine[last].toFixed(2),
    signal: +signalLine[last].toFixed(2),
    histogram: +(macdLine[last] - signalLine[last]).toFixed(2),
    prevHistogram: last > 0 ? +(macdLine[last - 1] - signalLine[last - 1]).toFixed(2) : 0,
  };
}

function calcEMAArray(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  const result = [];
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(ema); continue; }
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return +atr.toFixed(2);
}

function compactCrucixObj(crucix) {
  if (!crucix) return null;
  const result = {};
  const m = crucix.markets;
  if (m?.vix) result.vix = m.vix;
  if (m?.crypto?.BTC) result.btc = m.crypto.BTC;
  if (m?.crypto?.ETH) result.eth = m.crypto.ETH;
  if (m?.sp500) result.sp500 = m.sp500;
  if (m?.gold) result.gold = m.gold;
  const e = crucix.energy;
  if (e?.wti) result.wti = e.wti;
  if (e?.natgas) result.natgas = e.natgas;
  const a = crucix.acled;
  if (a) result.conflicts = { events: a.totalEvents, fatalities: a.totalFatalities };
  const tg = crucix.tg;
  if (tg?.urgent) result.tg_urgent = tg.urgent;
  return result;
}

function compactCrucix(crucix) {
  if (!crucix) return 'Crucix: unavailable';
  const parts = [];
  const m = crucix.markets;
  if (m?.vix) parts.push(`VIX: ${m.vix}`);
  if (m?.crypto?.BTC) parts.push(`BTC: $${m.crypto.BTC}`);
  if (m?.crypto?.ETH) parts.push(`ETH: $${m.crypto.ETH}`);
  if (m?.sp500) parts.push(`S&P500: ${m.sp500}`);
  if (m?.gold) parts.push(`Gold: $${m.gold}`);
  const e = crucix.energy;
  if (e?.wti) parts.push(`WTI: $${e.wti}`);
  if (e?.natgas) parts.push(`NatGas: $${e.natgas}`);
  const a = crucix.acled;
  if (a) parts.push(`Conflicts: ${a.totalEvents} events, ${a.totalFatalities} fatalities`);
  const w = crucix.weather;
  if (w?.alerts) parts.push(`Weather alerts: ${w.alerts}`);
  const tg = crucix.tg;
  if (tg?.urgent) parts.push(`TG urgent: ${tg.urgent}`);
  return parts.join(' | ') || 'Crucix: no data';
}

function compactNews(news) {
  if (!news?.length) return 'News: none';
  return news.slice(0, 10).map((n, i) => {
    const score = n.score || n.aiRating?.score || '?';
    const signal = n.signal || n.aiRating?.signal || '?';
    const title = (n.title || n.headline || '').slice(0, 120);
    const src = n.source || '?';
    return `${i + 1}. [${signal}|${score}] ${title} (${src})`;
  }).join('\n');
}

function buildPrompt(mode, crucixSummary, newsSummary, now) {
  if (mode === 'stock') {
    return `You are a senior US equity market intelligence analyst. Analyze the following real-time data and produce a structured JSON report focused on US stock market conditions.

Current time: ${now}

=== MACRO & MARKET DATA (Crucix 27-source intelligence) ===
${crucixSummary}

=== NEWS (AI-scored, signal: long/short/neutral) ===
${newsSummary}

Produce a JSON object with these exact fields:
{
  "macro_risk_score": <0-100, higher = more risk>,
  "stock_sentiment": <0-100, higher = more bullish on US equities>,
  "technical_bias": "long" | "short" | "neutral",
  "recommended_action": "strong_buy" | "increase_exposure" | "hold" | "reduce_exposure" | "strong_sell",
  "confidence": <0-100>,
  "alerts": [
    { "level": "FLASH|PRIORITY|ROUTINE", "signal": "<one-line Chinese description>", "source": "<data source>", "relevance": <0-100> }
  ],
  "briefing": "<3-4 sentence Chinese briefing for a US stock trader. Focus on S&P500, VIX, sector rotation, rate expectations, geopolitical impact on equities. Actionable, with reasoning. Include specific numbers.>",
  "push_worthy": <true if any alert deserves immediate user notification, false otherwise>,
  "push_reason": "<if push_worthy, one-line Chinese reason>"
}

Rules:
- alerts: max 6, sorted by relevance desc. FLASH = market-moving. PRIORITY = notable. ROUTINE = FYI.
- briefing: Chinese only, no English, no markdown. Include specific prices/numbers from data.
- Focus on equity-relevant signals: VIX changes, S&P500 moves, gold as safe-haven indicator, energy prices impact on sectors, geopolitical risk to markets.
- Filter out pure crypto news unless it has macro spillover implications (e.g. major regulatory action).
- push_worthy: true only for FLASH-level events (VIX spike >25, S&P500 drop >2%, major Fed action, geopolitical escalation)
- Be precise with numbers, don't round excessively

Output ONLY the JSON, no other text.`;
  }

  // Default: crypto mode (original prompt)
  return `You are a senior crypto trading intelligence analyst. Analyze the following real-time data and produce a structured JSON report.

Current time: ${now}

=== MACRO & MARKET DATA (Crucix 27-source intelligence) ===
${crucixSummary}

=== CRYPTO NEWS (AI-scored, signal: long/short/neutral) ===
${newsSummary}

Produce a JSON object with these exact fields:
{
  "macro_risk_score": <0-100, higher = more risk>,
  "crypto_sentiment": <0-100, higher = more bullish>,
  "technical_bias": "long" | "short" | "neutral",
  "recommended_action": "strong_buy" | "increase_exposure" | "hold" | "reduce_exposure" | "strong_sell",
  "confidence": <0-100>,
  "alerts": [
    { "level": "FLASH|PRIORITY|ROUTINE", "signal": "<one-line Chinese description>", "source": "<data source>", "relevance": <0-100> }
  ],
  "briefing": "<3-4 sentence Chinese briefing for a crypto trader. Actionable, with reasoning. Include specific numbers.>",
  "push_worthy": <true if any alert deserves immediate user notification, false otherwise>,
  "push_reason": "<if push_worthy, one-line Chinese reason>"
}

Rules:
- alerts: max 6, sorted by relevance desc. FLASH = market-moving. PRIORITY = notable. ROUTINE = FYI.
- briefing: Chinese only, no English, no markdown. Include specific prices/numbers from data.
- push_worthy: true only for FLASH-level events (VIX spike, major hack, regulation news, 5%+ price move)
- Be precise with numbers, don't round excessively

Output ONLY the JSON, no other text.`;
}

async function runFullAnalysis(mode, crucix, news) {
  const c = cache[mode];
  if (c.analyzing) return;
  c.analyzing = true;

  const now = new Date().toISOString();
  const traceId = `analysis_${mode}_${Date.now()}`;

  try {
    // --- Analyst Agent ---
    const analystPrompt = buildAnalystSystemPrompt(mode);
    const analystResult = await runAgent('analyst', analystPrompt, ANALYST_TOOLS, ANALYST_EXECUTORS,
      `Analyze current ${mode} market conditions. Time: ${now}. Fetch data using your tools, then produce the JSON report.`,
      { trace_id: traceId, max_tokens: 1000, timeout: 90000 }
    );

    let parsed;
    try {
      const jsonStr = analystResult.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error(`[Analyst:${mode}] JSON parse failed, raw:`, analystResult.content.slice(0, 200));
      c.analyzing = false;
      return;
    }

    c.analysis = {
      ...parsed,
      mode,
      timestamp: now,
      trace_id: traceId,
      raw_sources: { crucix: analystResult.toolCalls.some(t => t.name === 'get_crucix_data'), news: analystResult.toolCalls.some(t => t.name === 'get_crypto_news') },
      agent: 'analyst',
    };
    c.lastUpdate = now;

    const sentimentKey = mode === 'stock' ? 'stock_sentiment' : 'crypto_sentiment';
    const sentimentVal = parsed[sentimentKey] || 0;
    console.log(`[${now}] ${mode} analyst | Risk:${parsed.macro_risk_score} ${sentimentKey}:${sentimentVal} Bias:${parsed.technical_bias} Action:${parsed.recommended_action} Push:${parsed.push_worthy} Tools:${analystResult.toolCalls.length}`);

    // Persist to SQLite
    persistAnalysis(mode, parsed, now);

    // Record analyst final decision
    try {
      insertDecision.run(now, 'analyst', 'analyze', '', '', JSON.stringify(parsed),
        `${mode} market analysis`, analystResult.content.slice(0, 500), '', parsed.confidence || 0, null);
    } catch {}

    // Post analyst result to message bus
    postMessage('analyst', 'risk', 'SIGNAL_UPDATE', parsed, traceId);

    // --- Risk Gate (crypto auto-trade) ---
    // Proactive: trigger on push_worthy OR strong action with high confidence
    const shouldTrade = parsed.push_worthy ||
      (parsed.confidence >= 75 && ['strong_buy', 'strong_sell'].includes(parsed.recommended_action));
    if (mode === 'crypto' && shouldTrade) {
      const riskVerdict = await runRiskCheck(parsed, traceId);
      if (riskVerdict.pass) {
        // Bitget CEX (primary) — direct execution in VPS
        executeBitgetTrade(parsed, traceId).catch(err => console.error('[BitgetExec] Error:', err.message));
        // On-chain (secondary) — if AUTO_TRADE_URL configured
        if (AUTO_TRADE_URL) {
          triggerAutoTrade({ ...parsed, trace_id: traceId, risk_verdict: riskVerdict })
            .catch(err => console.error('[AutoTrade] Trigger failed:', err.message));
        }
      } else {
        console.log(`[Risk] VETO: ${riskVerdict.reason}`);
        try {
          insertDecision.run(now, 'risk', 'veto', '', '', JSON.stringify(riskVerdict),
            'Auto-trade blocked by Risk agent', riskVerdict.reason, '', 0, null);
        } catch {}
      }
    }

    // --- Strategist Agent (crypto only, evaluate active strategies) ---
    if (mode === 'crypto') {
      runStrategistCheck(parsed, traceId).catch(err => console.error('[Strategist] Error:', err.message));
    }

    // Patrol report: accumulate and push every 3h (per mode)
    c.patrolHistory.push({ ...parsed, timestamp: now });
    c.patrolCounter++;
    if (c.patrolCounter >= PATROL_INTERVAL) {
      pushPatrolReport(mode, c.patrolHistory).catch(err => console.error(`[Patrol:${mode}] Error:`, err.message));
      // Run Reviewer alongside patrol (every 3h)
      if (mode === 'crypto') {
        runReview(traceId).catch(err => console.error('[Reviewer] Error:', err.message));
        // Check if weekly review is due (self-healing: checks on every patrol cycle)
        runWeeklyReview(traceId).catch(err => console.error('[WeeklyReview] Error:', err.message));
      }
      c.patrolHistory = [];
      c.patrolCounter = 0;
    }
  } catch (err) {
    console.error(`[Analysis:${mode}] Error:`, err.message);
  }
  c.analyzing = false;
}

// --- Patrol Report (3h summary) ---

async function generatePatrolReport(mode, history) {
  if (!history.length) return null;

  const sentimentKey = mode === 'stock' ? 'stock_sentiment' : 'crypto_sentiment';
  const roleLabel = mode === 'stock' ? '美股市场AI' : '加密交易AI';

  const summary = history.map((h) => {
    const t = new Date(h.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `${t} | Risk:${h.macro_risk_score} Sent:${h[sentimentKey] || 0} Bias:${h.technical_bias} Action:${h.recommended_action} Conf:${h.confidence}`;
  }).join('\n');

  const prompt = `你是${roleLabel}的巡逻报告员。以下是过去3小时每15分钟一次的市场分析记录（共${history.length}次）：

${summary}

最新一次的完整 briefing：${history[history.length - 1]?.briefing || 'N/A'}

请生成一份简洁的3小时巡逻报告（中文），包含：
1. 这3小时内市场整体走势（risk/sentiment 变化趋势）
2. 是否有值得注意的变化或异常
3. AI 做了什么操作（如果全是hold就说"未执行任何交易"）
4. 下一阶段关注点

要求：4-6句话，简洁直接，像给老板的快报。不要用markdown格式符号。`;

  try {
    const result = await llm([{ role: 'user', content: prompt }], { max_tokens: 400, timeout: 20000 });
    return result.content;
  } catch (err) {
    console.error(`[Patrol:${mode}] Report generation failed:`, err.message);
    const latest = history[history.length - 1];
    return `过去3小时完成${history.length}次${mode === 'stock' ? '美股' : '加密'}市场扫描。最新状态：风险${latest.macro_risk_score}/100，情绪${latest[sentimentKey] || 0}/100，偏向${latest.technical_bias}，建议${latest.recommended_action}。未执行交易。`;
  }
}

async function pushPatrolReport(mode, history) {
  const report = await generatePatrolReport(mode, history);
  if (!report) return;

  const sentimentKey = mode === 'stock' ? 'stock_sentiment' : 'crypto_sentiment';
  const risks = history.map(h => h.macro_risk_score);
  const sents = history.map(h => h[sentimentKey] || 0);
  const actions = history.map(h => h.recommended_action);
  const trades = actions.filter(a => a === 'strong_buy' || a === 'strong_sell' || a === 'increase_exposure');

  const period = `${new Date(history[0].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(history[history.length - 1].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  const riskRange = `${Math.min(...risks)}-${Math.max(...risks)}`;
  const sentRange = `${Math.min(...sents)}-${Math.max(...sents)}`;

  // Persist to SQLite
  persistPatrol(mode, report, period, history.length, riskRange, sentRange, trades.length, new Date().toISOString());

  // Push via frontend SSE (crypto only — stock has no auto-trade)
  if (AUTO_TRADE_URL && mode === 'crypto') {
    const payload = {
      type: 'PATROL_REPORT',
      level: 'LOW',
      data: {
        report, mode, period,
        scans: history.length,
        risk_range: riskRange,
        sentiment_range: sentRange,
        trades_executed: trades.length,
        dominant_action: mostCommon(actions),
      },
      timestamp: new Date().toISOString(),
    };

    const baseUrl = AUTO_TRADE_URL.replace('/api/auto-trade', '');
    try {
      await fetch(`${baseUrl}/api/patrol-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTO_TRADE_SECRET}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      console.log(`[Patrol:${mode}] 3h report pushed (${history.length} scans)`);
    } catch (err) {
      console.error(`[Patrol:${mode}] Push failed: ${err.message}`);
    }
  }
}

function mostCommon(arr) {
  const freq = {};
  for (const v of arr) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'hold';
}

// --- Risk Agent ---

const RISK_SYSTEM_PROMPT = `You are the RIFI Risk Agent. Your sole job is to review trade signals and decide PASS or VETO.

You have tools to check the current portfolio state and trade history. Use them before deciding.

Hard rules (automatic VETO, non-negotiable):
- 24h cumulative loss > 5% of portfolio → VETO
- 3 consecutive losing trades → VETO (1h cooldown needed)
- Account balance too low to execute → VETO

Soft rules (use judgment):
- Analyst confidence < 60 → lean toward VETO
- Same direction position already open → warn, lean toward VETO unless strong signal
- Signal conflicts with recent trade direction in last 1h → extra caution

Your workflow:
1. Call get_trade_stats to check recent performance
2. Call get_recent_decisions to see what happened recently
3. Evaluate the signal against rules
4. Respond with ONLY this JSON:
{
  "verdict": "PASS" | "VETO",
  "reason": "<one-line Chinese explanation>",
  "risk_flags": ["<any warnings even if PASS>"]
}`;

const RISK_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_trade_stats',
      description: 'Get trading performance stats: win rate, PnL, drawdown, open positions, recent closed trades',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_decisions',
      description: 'Get recent agent decisions from the decision ledger (last 20)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const RISK_EXECUTORS = {
  get_trade_stats: async () => {
    const closed = db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT 20').all('closed');
    const open = db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY opened_at DESC').all('open');
    const wins = closed.filter(t => t.pnl > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    // 24h loss check
    const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent24h = closed.filter(t => t.closed_at && t.closed_at > h24);
    const loss24h = recent24h.reduce((s, t) => s + Math.min(0, t.pnl || 0), 0);
    // Consecutive losses
    let consecutiveLosses = 0;
    for (const t of closed) {
      if (t.pnl <= 0) consecutiveLosses++;
      else break;
    }
    return JSON.stringify({
      total_closed: closed.length, wins: wins.length,
      win_rate: closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) + '%' : 'N/A',
      total_pnl: totalPnl.toFixed(4),
      loss_24h: loss24h.toFixed(4),
      consecutive_losses: consecutiveLosses,
      open_positions: open.map(t => ({ pair: t.pair, side: t.side, amount: t.amount, entry_price: t.entry_price })),
      recent_3: closed.slice(0, 3).map(t => ({ pnl: t.pnl, side: t.side, closed_at: t.closed_at })),
    });
  },
  get_recent_decisions: async () => {
    const rows = db.prepare('SELECT timestamp, agent, action, tool_name, reasoning FROM decisions ORDER BY timestamp DESC LIMIT 20').all();
    return JSON.stringify(rows);
  },
};

/**
 * Run Risk agent check. Returns { pass: boolean, reason: string, risk_flags: string[] }
 */
async function runRiskCheck(signal, traceId) {
  const now = new Date().toISOString();

  // --- Hard rules (code-level, cannot be bypassed by LLM) ---

  // Check consecutive losses
  const recentTrades = db.prepare('SELECT pnl FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT 3').all('closed');
  const consecutiveLosses = recentTrades.length >= 3 && recentTrades.every(t => t.pnl <= 0);

  // Check last loss time for cooldown
  if (consecutiveLosses) {
    const lastLoss = db.prepare('SELECT closed_at FROM trades WHERE status = ? AND pnl <= 0 ORDER BY closed_at DESC LIMIT 1').get('closed');
    if (lastLoss?.closed_at) {
      const cooldownEnd = new Date(lastLoss.closed_at).getTime() + 60 * 60 * 1000; // 1h
      if (Date.now() < cooldownEnd) {
        const reason = `连续3笔亏损，冷却期至 ${new Date(cooldownEnd).toISOString().slice(11, 16)}`;
        postMessage('risk', 'executor', 'VETO', { reason }, traceId);
        return { pass: false, reason, risk_flags: ['consecutive_losses', 'cooldown_active'] };
      }
    }
  }

  // Check 24h cumulative loss > 5% (approximate using USDC terms)
  const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent24h = db.prepare('SELECT pnl FROM trades WHERE status = ? AND closed_at > ?').all('closed', h24);
  const loss24h = recent24h.reduce((s, t) => s + Math.min(0, t.pnl || 0), 0);
  if (loss24h < -50) { // >50 USDC loss in 24h → VETO (hard threshold)
    const reason = `24小时累计亏损 ${loss24h.toFixed(2)} USDC，超过安全阈值`;
    postMessage('risk', 'executor', 'VETO', { reason }, traceId);
    return { pass: false, reason, risk_flags: ['24h_loss_limit'] };
  }

  // --- Soft rules: let Risk agent LLM evaluate ---
  try {
    const result = await runAgent('risk', RISK_SYSTEM_PROMPT, RISK_TOOLS, RISK_EXECUTORS,
      `Review this trade signal and decide PASS or VETO:\n${JSON.stringify(signal, null, 2)}`,
      { trace_id: traceId, max_tokens: 400, timeout: 20000 }
    );

    let verdict;
    try {
      const jsonStr = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      verdict = JSON.parse(jsonStr);
    } catch {
      // If can't parse, default to PASS with warning
      console.warn(`[Risk] Could not parse verdict, defaulting to PASS. Raw: ${result.content.slice(0, 100)}`);
      verdict = { verdict: 'PASS', reason: 'Risk agent parse error, defaulting PASS', risk_flags: ['parse_error'] };
    }

    const pass = verdict.verdict === 'PASS';
    postMessage('risk', 'executor', pass ? 'PASS' : 'VETO', verdict, traceId);

    console.log(`[Risk] ${verdict.verdict}: ${verdict.reason}`);
    try {
      insertDecision.run(now, 'risk', pass ? 'approve' : 'veto', '', '',
        JSON.stringify(verdict), `Risk check for signal`, verdict.reason, '', signal.confidence || 0, null);
    } catch {}

    return { pass, reason: verdict.reason, risk_flags: verdict.risk_flags || [] };
  } catch (err) {
    console.error(`[Risk] Agent error: ${err.message}, defaulting to PASS`);
    return { pass: true, reason: `Risk agent error: ${err.message}`, risk_flags: ['agent_error'] };
  }
}

// --- Strategist Agent ---

const STRATEGIST_SYSTEM_PROMPT = `You are the RIFI Strategist Agent. You manage trading strategies and evaluate market conditions against active goals.

Your workflow:
1. Call list_strategies to see active strategies
2. Call get_latest_analysis to see current market conditions
3. Call get_trade_stats to see recent performance
4. Evaluate: does the current market match any active strategy's entry criteria?
5. If yes, recommend a trade action. If no, explain why not.

Strategy templates you understand:
- grid: buy/sell within a price range at intervals
- dca: dollar-cost average at fixed intervals/amounts
- ma_cross: moving average crossover signals
- trend: ATR channel + dynamic stop-loss
- event: VIX threshold / news event triggers
- custom: user-defined rules

Respond with JSON:
{
  "active_strategies": <count>,
  "triggered": [{ "strategy_id": <id>, "action": "buy|sell|hold", "reason": "<Chinese>" }],
  "summary": "<1-2 sentence Chinese summary of strategy evaluation>"
}`;

const STRATEGIST_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_strategies',
      description: 'List all active trading strategies with their goals and parameters',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_analysis',
      description: 'Get the latest market analysis from the Analyst agent (cached)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trade_stats',
      description: 'Get trading performance stats',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const STRATEGIST_EXECUTORS = {
  list_strategies: async () => {
    const rows = db.prepare('SELECT * FROM strategies WHERE status = ? ORDER BY created_at DESC').all('active');
    return JSON.stringify(rows.map(r => ({
      ...r,
      plan_json: r.plan_json ? JSON.parse(r.plan_json) : null,
      params_json: r.params_json ? JSON.parse(r.params_json) : null,
    })));
  },
  get_latest_analysis: async () => {
    const a = cache.crypto.analysis;
    if (!a) return JSON.stringify({ error: 'No analysis yet' });
    return JSON.stringify({
      macro_risk_score: a.macro_risk_score,
      crypto_sentiment: a.crypto_sentiment,
      technical_bias: a.technical_bias,
      recommended_action: a.recommended_action,
      confidence: a.confidence,
      briefing: a.briefing,
      timestamp: a.timestamp,
    });
  },
  get_trade_stats: RISK_EXECUTORS.get_trade_stats, // reuse
};

async function runStrategistCheck(analystSignal, traceId) {
  const activeCount = db.prepare('SELECT COUNT(*) as cnt FROM strategies WHERE status = ?').get('active').cnt;
  if (activeCount === 0) return null; // No strategies to evaluate

  try {
    const result = await runAgent('strategist', STRATEGIST_SYSTEM_PROMPT, STRATEGIST_TOOLS, STRATEGIST_EXECUTORS,
      `Evaluate active strategies against current market. Latest signal: ${JSON.stringify(analystSignal)}`,
      { trace_id: traceId, max_tokens: 600, timeout: 25000 }
    );

    let parsed;
    try {
      const jsonStr = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.warn(`[Strategist] Parse failed: ${result.content.slice(0, 100)}`);
      return null;
    }

    console.log(`[Strategist] ${parsed.active_strategies} strategies, ${parsed.triggered?.length || 0} triggered`);

    try {
      insertDecision.run(new Date().toISOString(), 'strategist', 'evaluate', '', '',
        JSON.stringify(parsed), 'Strategy evaluation', parsed.summary || '', '', analystSignal.confidence || 0, null);
    } catch {}

    // If any strategy triggered, send through Risk gate
    if (parsed.triggered?.length > 0) {
      for (const trigger of parsed.triggered) {
        if (trigger.action !== 'hold') {
          postMessage('strategist', 'risk', 'STRATEGY_TRIGGER', trigger, traceId);
        }
      }
    }

    return parsed;
  } catch (err) {
    console.error(`[Strategist] Error: ${err.message}`);
    return null;
  }
}

// --- Reviewer Agent ---

const REVIEWER_SYSTEM_PROMPT = `You are the RIFI Reviewer Agent. You analyze signal accuracy, completed trades, and extract actionable lessons.

Your workflow:
1. Call get_signal_accuracy to see prediction accuracy stats (most important!)
2. Call get_recent_trades to see recently closed trades
3. Call get_strategies to check strategy scores
4. Based on accuracy data, call save_lesson to record actionable insights
5. Update strategy scores if needed

Rules for save_lesson:
- Each lesson MUST reference specific accuracy numbers (e.g. "strong_buy 1h accuracy 45%")
- Do NOT save generic advice like "be careful" — only data-backed insights
- Good examples:
  "过去7天 strong_buy 信号的1h准确率仅45%，建议提高 confidence 阈值到70"
  "hold 信号4h准确率82%，当前保守策略有效，维持现有判断逻辑"
  "reduce_exposure 信号在 VIX>25 时4h准确率90%，高VIX环境下减仓信号可信度高"
- Save 1-3 lessons per review, not more

Respond with JSON:
{
  "trades_reviewed": <count>,
  "signal_accuracy_summary": "<Chinese one-line summary of accuracy>",
  "lessons_saved": <count>,
  "strategy_updates": [
    { "strategy_id": <id>, "new_score": <0-100>, "reason": "<Chinese>" }
  ],
  "insight": "<Chinese 2-3 sentence insight about trading patterns>"
}`;

const REVIEWER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_recent_trades',
      description: 'Get recently closed trades with PnL data',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Number of trades (default 10)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_decisions_for_trade',
      description: 'Get all agent decisions associated with a specific trade',
      parameters: {
        type: 'object',
        properties: { trade_id: { type: 'string', description: 'Trade ID to look up' } },
        required: ['trade_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_strategies',
      description: 'Get all strategies with their current scores',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_strategy_score',
      description: 'Update a strategy score based on performance review',
      parameters: {
        type: 'object',
        properties: {
          strategy_id: { type: 'number', description: 'Strategy ID' },
          score: { type: 'number', description: 'New score 0-100' },
        },
        required: ['strategy_id', 'score'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_signal_accuracy',
      description: 'Get signal prediction accuracy stats grouped by recommended_action. Shows how often each action type was correct at 15m, 1h, 4h horizons.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback period in days (default 7)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_lesson',
      description: 'Save a trading lesson learned from performance data. Must reference specific accuracy stats. Will be injected into Analyst prompt.',
      parameters: {
        type: 'object',
        properties: {
          lesson: { type: 'string', description: 'The lesson (Chinese, one sentence, with specific numbers)' },
          category: { type: 'string', enum: ['bias_correction', 'signal_weight', 'market_state', 'timing'], description: 'Lesson category' },
          confidence: { type: 'number', description: 'Confidence 0-100' },
          expires_days: { type: 'number', description: 'Auto-expire after N days (default: 14, 0=permanent)' },
        },
        required: ['lesson', 'category'],
      },
    },
  },
];

const REVIEWER_EXECUTORS = {
  get_recent_trades: async (args) => {
    const limit = args.limit || 10;
    const rows = db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT ?').all('closed', limit);
    return JSON.stringify(rows.map(t => ({
      trade_id: t.trade_id, pair: t.pair, side: t.side, pnl: t.pnl, pnl_pct: t.pnl_pct,
      entry_price: t.entry_price, exit_price: t.exit_price, opened_at: t.opened_at, closed_at: t.closed_at,
    })));
  },
  get_decisions_for_trade: async (args) => {
    const rows = db.prepare('SELECT * FROM decisions WHERE trade_id = ? ORDER BY timestamp ASC').all(args.trade_id);
    return JSON.stringify(rows.map(d => ({
      agent: d.agent, action: d.action, tool_name: d.tool_name, reasoning: d.reasoning, timestamp: d.timestamp,
    })));
  },
  get_strategies: async () => {
    const rows = db.prepare('SELECT * FROM strategies ORDER BY created_at DESC').all();
    return JSON.stringify(rows.map(r => ({
      id: r.id, goal: r.goal, template: r.template, status: r.status, score: r.score, progress_pct: r.progress_pct,
    })));
  },
  update_strategy_score: async (args) => {
    try {
      db.prepare('UPDATE strategies SET score = ?, updated_at = ? WHERE id = ?')
        .run(args.score, new Date().toISOString(), args.strategy_id);
      return JSON.stringify({ success: true, strategy_id: args.strategy_id, score: args.score });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  },
  get_signal_accuracy: async (args) => {
    const days = args.days || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT recommended_action,
        COUNT(*) as total,
        SUM(CASE WHEN correct_1h = 1 THEN 1 ELSE 0 END) as correct_1h,
        SUM(CASE WHEN correct_4h = 1 THEN 1 ELSE 0 END) as correct_4h,
        AVG(confidence) as avg_confidence
      FROM signal_scores WHERE scored_at > ? GROUP BY recommended_action
    `).all(since);
    const overall = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN correct_1h = 1 THEN 1 ELSE 0 END) as correct_1h,
        SUM(CASE WHEN correct_4h = 1 THEN 1 ELSE 0 END) as correct_4h
      FROM signal_scores WHERE scored_at > ?
    `).get(since);
    return JSON.stringify({
      period_days: days,
      overall: {
        total: overall.total,
        accuracy_1h: overall.total > 0 ? ((overall.correct_1h / overall.total) * 100).toFixed(1) + '%' : 'N/A',
        accuracy_4h: overall.total > 0 ? ((overall.correct_4h / overall.total) * 100).toFixed(1) + '%' : 'N/A',
      },
      by_action: rows.map(r => ({
        action: r.recommended_action,
        total: r.total,
        accuracy_1h: r.total > 0 ? ((r.correct_1h / r.total) * 100).toFixed(1) + '%' : 'N/A',
        accuracy_4h: r.total > 0 ? ((r.correct_4h / r.total) * 100).toFixed(1) + '%' : 'N/A',
        avg_confidence: r.avg_confidence?.toFixed(0) || 'N/A',
      })),
    });
  },
  save_lesson: async (args) => {
    const expiresDays = args.expires_days !== undefined ? args.expires_days : 14;
    const expiresAt = expiresDays > 0 ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString() : null;
    // Cap active lessons at 10
    const activeCount = db.prepare('SELECT COUNT(*) as cnt FROM lessons WHERE active = 1').get().cnt;
    if (activeCount >= 10) {
      // Deactivate oldest
      db.prepare('UPDATE lessons SET active = 0 WHERE id = (SELECT id FROM lessons WHERE active = 1 ORDER BY created_at ASC LIMIT 1)').run();
    }
    try {
      const result = db.prepare(`
        INSERT INTO lessons (source, lesson, category, confidence, active, expires_at)
        VALUES ('reviewer', ?, ?, ?, 1, ?)
      `).run(args.lesson, args.category || 'general', args.confidence || 50, expiresAt);
      console.log(`[Lesson] Saved: ${args.lesson.slice(0, 60)}...`);
      return JSON.stringify({ success: true, id: result.lastInsertRowid });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  },
};

async function runReview(traceId) {
  const closedCount = db.prepare('SELECT COUNT(*) as cnt FROM trades WHERE status = ?').get('closed').cnt;
  if (closedCount === 0) return null; // Nothing to review

  try {
    const result = await runAgent('reviewer', REVIEWER_SYSTEM_PROMPT, REVIEWER_TOOLS, REVIEWER_EXECUTORS,
      `Review recent trades and evaluate strategy performance. Provide insights.`,
      { trace_id: traceId || `review_${Date.now()}`, max_tokens: 600, timeout: 30000 }
    );

    let parsed;
    try {
      const jsonStr = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.warn(`[Reviewer] Parse failed: ${result.content.slice(0, 100)}`);
      return null;
    }

    console.log(`[Reviewer] Reviewed ${parsed.trades_reviewed} trades, ${parsed.strategy_updates?.length || 0} strategy updates`);

    try {
      insertDecision.run(new Date().toISOString(), 'reviewer', 'review', '', '',
        JSON.stringify(parsed), 'Trade review', parsed.weekly_insight || '', '', 0, null);
    } catch {}

    return parsed;
  } catch (err) {
    console.error(`[Reviewer] Error: ${err.message}`);
    return null;
  }
}

// --- Weekly Self-Review ---

const WEEKLY_REVIEW_PROMPT = `You are the RIFI Reviewer Agent performing a WEEKLY review. This is a comprehensive analysis of the past 7 days.

Your workflow:
1. Call get_signal_accuracy with days=7 to get this week's prediction accuracy
2. Call get_recent_trades with limit=20 to see this week's trades
3. Based on data, save 1-3 high-quality lessons using save_lesson
4. Deactivate any outdated lessons using deactivate_lesson

Focus areas:
- Which action types (strong_buy/hold/etc.) were most accurate?
- Any systematic bias? (e.g. too many false strong_buy signals)
- What market conditions led to correct vs incorrect predictions?
- Save data-backed lessons that will improve next week's analysis

Respond with JSON:
{
  "period": "<date range>",
  "total_pnl": <number>,
  "win_rate": "<percent>",
  "best_trade": { "trade_id": "<id>", "pnl": <number>, "lesson": "<Chinese>" },
  "worst_trade": { "trade_id": "<id>", "pnl": <number>, "lesson": "<Chinese>" },
  "signal_accuracy_1h": "<percent>",
  "signal_accuracy_4h": "<percent>",
  "lessons_saved": <count>,
  "lessons_deactivated": <count>,
  "telegram_summary": "<Chinese 5-sentence weekly summary for Telegram push>"
}`;

const WEEKLY_TOOLS = [
  ...REVIEWER_TOOLS,
  {
    type: 'function',
    function: {
      name: 'deactivate_lesson',
      description: 'Deactivate an outdated lesson that is no longer accurate',
      parameters: {
        type: 'object',
        properties: { lesson_id: { type: 'number', description: 'Lesson ID to deactivate' } },
        required: ['lesson_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_lessons',
      description: 'Get all currently active lessons injected into the Analyst prompt',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const WEEKLY_EXECUTORS = {
  ...REVIEWER_EXECUTORS,
  deactivate_lesson: async (args) => {
    try {
      db.prepare('UPDATE lessons SET active = 0 WHERE id = ?').run(args.lesson_id);
      return JSON.stringify({ success: true, lesson_id: args.lesson_id });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  },
  get_active_lessons: async () => {
    const rows = db.prepare('SELECT id, lesson, category, confidence, created_at FROM lessons WHERE active = 1 ORDER BY created_at DESC').all();
    return JSON.stringify(rows);
  },
};

const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function runWeeklyReview(traceId) {
  // Check if 7+ days since last weekly review
  const last = db.prepare("SELECT timestamp FROM decisions WHERE agent = 'reviewer' AND action = 'weekly_review' ORDER BY timestamp DESC LIMIT 1").get();
  if (last && (Date.now() - new Date(last.timestamp).getTime()) < WEEKLY_INTERVAL_MS) return null;

  console.log('[WeeklyReview] Starting weekly self-review...');

  try {
    const result = await runAgent('reviewer', WEEKLY_REVIEW_PROMPT, WEEKLY_TOOLS, WEEKLY_EXECUTORS,
      `Perform a comprehensive weekly review. Today: ${new Date().toISOString()}`,
      { trace_id: traceId || `weekly_${Date.now()}`, max_tokens: 1000, timeout: 60000 }
    );

    let parsed;
    try {
      const jsonStr = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.warn(`[WeeklyReview] Parse failed: ${result.content.slice(0, 100)}`);
      return null;
    }

    console.log(`[WeeklyReview] PnL: ${parsed.total_pnl}, WinRate: ${parsed.win_rate}, Lessons: +${parsed.lessons_saved} -${parsed.lessons_deactivated}`);

    // Record
    try {
      insertDecision.run(new Date().toISOString(), 'reviewer', 'weekly_review', '', '',
        JSON.stringify(parsed), 'Weekly self-review', parsed.telegram_summary || '', '', 0, null);
    } catch {}

    // Push to Telegram if configured
    if (TG_BOT_TOKEN && TG_CHAT_ID && parsed.telegram_summary) {
      try {
        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHAT_ID, text: `📊 RIFI Weekly Report\n\n${parsed.telegram_summary}`, parse_mode: 'HTML' }),
          signal: AbortSignal.timeout(10000),
        });
        console.log('[WeeklyReview] Telegram push sent');
      } catch (e) {
        console.error('[WeeklyReview] Telegram push failed:', e.message);
      }
    }

    return parsed;
  } catch (err) {
    console.error(`[WeeklyReview] Error: ${err.message}`);
    return null;
  }
}

// --- Auto-Trade Trigger (crypto only) ---

async function triggerAutoTrade(signal) {
  const traceId = signal.trace_id || `trade_${Date.now()}`;
  const riskVerdict = signal.risk_verdict;
  console.log(`[Executor] Push-worthy signal → Risk: ${riskVerdict?.pass ? 'PASS' : 'N/A'} | ${signal.push_reason || 'high-value'}`);
  try {
    const res = await fetch(AUTO_TRADE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTO_TRADE_SECRET}` },
      body: JSON.stringify({ signal, trace_id: traceId }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    console.log(`[Executor] Response: ${data.status} | Tools: ${data.tool_calls || 0}`);
    postMessage('executor', 'reviewer', 'TRADE_RESULT', data, traceId);
  } catch (err) {
    console.error(`[Executor] Failed: ${err.message}`);
  }
}

// --- Bitget Auto-Trade Executor ---

async function executeBitgetTrade(signal, traceId) {
  if (!BITGET_API_KEY) { console.log('[BitgetExec] No API key, skip'); return; }

  const action = signal.recommended_action;
  const confidence = signal.confidence || 0;

  // Trade on actionable signals (Risk Agent already approved)
  if (['hold'].includes(action)) {
    console.log(`[BitgetExec] Action "${action}", skip`);
    return;
  }

  // Determine trade params
  const side = action === 'strong_buy' ? 'buy' : 'sell';
  const tradeSide = action === 'strong_buy' ? 'open' : 'open'; // open long or open short
  const holdSide = action === 'strong_buy' ? 'long' : 'short';

  // Use ETH futures as default (affordable with small balance)
  const symbol = 'ETHUSDT';
  const size = '0.01'; // min ETH size
  const leverage = '10';

  try {
    // Check balance first
    const accounts = await bitgetRequest('GET', '/api/v2/mix/account/accounts?productType=USDT-FUTURES');
    const usdtBal = accounts?.find(a => a.marginCoin === 'USDT');
    const available = parseFloat(usdtBal?.crossedMaxAvailable || usdtBal?.available || '0');

    if (available < 0.5) {
      console.log(`[BitgetExec] Insufficient balance: $${available.toFixed(2)}`);
      insertDecision.run(new Date().toISOString(), 'executor', 'skip', '', '',
        JSON.stringify({ reason: 'insufficient_balance', available }), 'Bitget trade skipped', '', '', confidence, null);
      return;
    }

    // Set leverage
    await bitgetRequest('POST', '/api/v2/mix/account/set-leverage', {
      symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT', leverage, holdSide,
    }).catch(() => {});

    // Place order
    const order = await bitgetRequest('POST', '/api/v2/mix/order/place-order', {
      symbol, productType: 'USDT-FUTURES', marginMode: 'crossed', marginCoin: 'USDT',
      side, tradeSide, orderType: 'market', size,
    });

    const orderId = order?.orderId;
    console.log(`[BitgetExec] ${holdSide.toUpperCase()} ${size} ${symbol} 10x | orderId: ${orderId}`);

    // Record trade
    insertTrade.run(
      `bg_${orderId}`, 'bitget', `${symbol}`, side, 0, parseFloat(size), 0,
      'open', orderId || '', JSON.stringify(signal), `${action} conf:${confidence}`, new Date().toISOString()
    );

    insertDecision.run(new Date().toISOString(), 'executor', 'bitget_trade', 'place-order', JSON.stringify({ symbol, side, size, leverage }),
      JSON.stringify(order), `Bitget ${holdSide} ${symbol}`, '', '', confidence, `bg_${orderId}`);

    postMessage('executor', 'reviewer', 'TRADE_RESULT', { source: 'bitget', orderId, symbol, side, size }, traceId);

  } catch (err) {
    console.error(`[BitgetExec] Failed: ${err.message}`);
    insertDecision.run(new Date().toISOString(), 'executor', 'bitget_error', '', '',
      JSON.stringify({ error: err.message }), 'Bitget trade failed', err.message, '', 0, null);
  }
}

// --- Signal Annotation Engine ---

const insertSignalScore = db.prepare(`
  INSERT OR IGNORE INTO signal_scores (analysis_id, recommended_action, confidence, price_at_signal, price_15m, price_1h, price_4h, correct_15m, correct_1h, correct_4h)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function findCandlePrice(pair, isoTime) {
  const bucket = getCandleBucket(new Date(isoTime).getTime());
  const row = db.prepare('SELECT close FROM candles WHERE pair = ? AND ts_start <= ? ORDER BY ts_start DESC LIMIT 1').get(pair, bucket);
  return row?.close || null;
}

function isActionCorrect(action, priceBefore, priceAfter) {
  if (!priceBefore || !priceAfter) return null;
  const change = (priceAfter - priceBefore) / priceBefore;
  if (action === 'strong_buy' || action === 'increase_exposure') return change > 0 ? 1 : 0;
  if (action === 'strong_sell' || action === 'reduce_exposure') return change < 0 ? 1 : 0;
  if (action === 'hold') return Math.abs(change) < 0.01 ? 1 : 0; // <1% = hold was correct
  return null;
}

function scoreHistoricalSignals() {
  // Score crypto analyses older than 4h that haven't been scored yet
  const unscored = db.prepare(`
    SELECT id, recommended_action, confidence, created_at
    FROM analysis
    WHERE mode = 'crypto'
      AND id NOT IN (SELECT analysis_id FROM signal_scores)
      AND created_at < datetime('now', '-4 hours')
    ORDER BY created_at DESC
    LIMIT 20
  `).all();

  if (unscored.length === 0) return;

  let scored = 0;
  for (const a of unscored) {
    const ts = new Date(a.created_at).getTime();
    const pair = 'ETH-USDT'; // primary trading pair

    const priceAt = findCandlePrice(pair, a.created_at);
    const price15m = findCandlePrice(pair, new Date(ts + 15 * 60 * 1000).toISOString());
    const price1h = findCandlePrice(pair, new Date(ts + 60 * 60 * 1000).toISOString());
    const price4h = findCandlePrice(pair, new Date(ts + 4 * 60 * 60 * 1000).toISOString());

    if (!priceAt) continue; // No candle data for this period

    const correct15m = isActionCorrect(a.recommended_action, priceAt, price15m);
    const correct1h = isActionCorrect(a.recommended_action, priceAt, price1h);
    const correct4h = isActionCorrect(a.recommended_action, priceAt, price4h);

    try {
      insertSignalScore.run(a.id, a.recommended_action, a.confidence, priceAt, price15m, price1h, price4h, correct15m, correct1h, correct4h);
      scored++;
    } catch {}
  }

  if (scored > 0) console.log(`[SignalScore] Scored ${scored} historical signals`);

  // Expire old lessons
  try {
    db.prepare("UPDATE lessons SET active = 0 WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run();
  } catch {}
}

// --- Source Score Tracking ---

function updateSourceScores() {
  const period = new Date().toISOString().slice(0, 7); // '2026-03'
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Aggregate signal_scores from last 30 days
  const stats = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN correct_1h = 1 THEN 1 ELSE 0 END) as correct
    FROM signal_scores WHERE scored_at > ?
  `).get(since);

  if (!stats || stats.total < 5) return; // Need minimum data

  // For now we track aggregate signal accuracy as "analyst_combined"
  // When we add per-source attribution (Phase 4.5+), this becomes per-source
  const sources = [
    { name: 'analyst_combined', total: stats.total, correct: stats.correct },
  ];

  for (const s of sources) {
    const accuracy = s.total > 0 ? s.correct / s.total : 0;
    const weight = 0.5 + accuracy; // 50% acc → 1.0x, 80% → 1.3x
    try {
      db.prepare(`
        INSERT INTO source_scores (source_name, period, total_signals, correct_signals, accuracy, weight, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_name, period) DO UPDATE SET
          total_signals = ?, correct_signals = ?, accuracy = ?, weight = ?, updated_at = ?
      `).run(s.name, period, s.total, s.correct, accuracy, weight, new Date().toISOString(),
        s.total, s.correct, accuracy, weight, new Date().toISOString());
    } catch {}
  }
}

function getSourceWeights() {
  const period = new Date().toISOString().slice(0, 7);
  const rows = db.prepare('SELECT source_name, accuracy, weight FROM source_scores WHERE period = ?').all(period);
  return rows.length > 0 ? rows : [{ source_name: 'analyst_combined', accuracy: 0, weight: 1.0 }];
}

// --- Telegram Alerting ---

async function sendTelegramAlert(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error('[Alert] Telegram send failed:', e.message);
  }
}

const alertCooldowns = {}; // { 'consecutive_loss': timestamp }
function alertCooldown(key, intervalMs = 60 * 60 * 1000) {
  const now = Date.now();
  if (alertCooldowns[key] && now - alertCooldowns[key] < intervalMs) return true;
  alertCooldowns[key] = now;
  return false;
}

function checkAlerts() {
  // 1. Consecutive losses (3+)
  const recentTrades = db.prepare('SELECT pnl FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT 5').all('closed');
  const consecutiveLosses = recentTrades.filter((t, i) => i < 3 && t.pnl <= 0).length;
  if (consecutiveLosses >= 3 && !alertCooldown('consecutive_loss', 3 * 60 * 60 * 1000)) {
    const totalLoss = recentTrades.slice(0, 3).reduce((s, t) => s + t.pnl, 0);
    sendTelegramAlert(`⚠️ <b>RIFI Alert: 连续亏损</b>\n连续 ${consecutiveLosses} 笔亏损，累计 ${totalLoss.toFixed(2)} USDC\n风控已触发1小时冷却期`);
  }

  // 2. Agent errors (error rate > 30%)
  for (const [name, m] of Object.entries(agentMetrics)) {
    if (m.calls >= 5 && m.errors / m.calls > 0.3 && !alertCooldown(`agent_error_${name}`, 6 * 60 * 60 * 1000)) {
      sendTelegramAlert(`⚠️ <b>RIFI Alert: ${name} Agent 异常</b>\n错误率 ${((m.errors / m.calls) * 100).toFixed(0)}% (${m.errors}/${m.calls})\n请检查 LLM 服务状态`);
    }
  }

  // 3. Agent heartbeat (no analysis in 30min)
  const lastAnalysis = cache.crypto.lastUpdate;
  if (lastAnalysis) {
    const silentMs = Date.now() - new Date(lastAnalysis).getTime();
    if (silentMs > 30 * 60 * 1000 && !alertCooldown('heartbeat', 60 * 60 * 1000)) {
      sendTelegramAlert(`⚠️ <b>RIFI Alert: 心跳异常</b>\n上次分析: ${lastAnalysis}\n已超过 ${Math.round(silentMs / 60000)} 分钟无新分析`);
    }
  }

  // 4. Large single loss (check latest closed trade)
  if (recentTrades.length > 0 && recentTrades[0].pnl < -10 && !alertCooldown('large_loss', 60 * 60 * 1000)) {
    sendTelegramAlert(`🚨 <b>RIFI Alert: 大额亏损</b>\n最近一笔亏损 ${recentTrades[0].pnl.toFixed(2)} USDC\n请确认风控参数`);
  }
}

// --- Collect & Analyze ---

async function collectAndAnalyze() {
  console.log(`[${new Date().toISOString()}] Collecting data...`);
  const [crucix, news] = await Promise.all([fetchCrucix(), fetchNews()]);
  const newsCount = Array.isArray(news) ? news.length : 0;
  console.log(`[${new Date().toISOString()}] Data collected. Crucix:${!!crucix} News:${newsCount}. Running dual analysis...`);

  // Persist raw news
  if (newsCount > 0) persistNews(news);

  // Run both modes in parallel
  await Promise.all([
    runFullAnalysis('crypto', crucix, news),
    runFullAnalysis('stock', crucix, news),
  ]);

  // Score historical signals (non-blocking)
  try { scoreHistoricalSignals(); } catch (e) { console.error('[SignalScore] Error:', e.message); }

  // Update source scores monthly
  try { updateSourceScores(); } catch (e) { console.error('[SourceScore] Error:', e.message); }

  // Check alert conditions
  try { checkAlerts(); } catch (e) { console.error('[Alerts] Error:', e.message); }

  // Technical scan + limit orders (every cycle)
  scanMarketOpportunities().catch(e => console.error('[Scanner] Error:', e.message));
}

// --- Routes ---

app.get('/api/prices', (req, res) => {
  const prices = {};
  for (const pair of PRICE_PAIRS) {
    const c = priceCache[pair];
    prices[pair] = {
      price: c.price,
      change5m: Number((c.change5m * 100).toFixed(3)),
      high5m: c.high5m,
      low5m: c.low5m,
      updated: c.ts ? new Date(c.ts).toISOString() : null,
    };
  }
  res.json({ prices, ws_connected: wsConnected, pairs: PRICE_PAIRS });
});

app.get('/api/candles', (req, res) => {
  const pair = req.query.pair || 'ETH-USDT';
  const hours = Math.min(parseInt(req.query.hours) || 24, 168); // max 7 days
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare('SELECT pair, open, high, low, close, ts_start FROM candles WHERE pair = ? AND ts_start > ? ORDER BY ts_start ASC').all(pair, since);
  res.json({ pair, hours, count: rows.length, candles: rows });
});

app.get('/api/signals', (req, res) => {
  const mode = req.query.mode === 'stock' ? 'stock' : 'crypto';
  const c = cache[mode];
  if (!c.analysis) return res.json({ error: 'First analysis in progress.', mode });
  res.json(c.analysis);
});

app.get('/api/analysis', (req, res) => {
  const mode = req.query.mode === 'stock' ? 'stock' : 'crypto';
  const c = cache[mode];
  if (!c.analysis) return res.json({ error: 'Not ready.', mode });
  res.json({ token: req.query.token || (mode === 'stock' ? 'SPX' : 'ETH'), ...c.analysis, last_update: c.lastUpdate });
});

app.get('/api/health', (req, res) => {
  const newsCount = db.prepare('SELECT COUNT(*) as cnt FROM news').get().cnt;
  const analysisCount = db.prepare('SELECT COUNT(*) as cnt FROM analysis').get().cnt;
  res.json({
    status: 'ok',
    modes: {
      crypto: { last_update: cache.crypto.lastUpdate, cached: !!cache.crypto.analysis, push_worthy: cache.crypto.analysis?.push_worthy || false },
      stock:  { last_update: cache.stock.lastUpdate, cached: !!cache.stock.analysis },
    },
    agents: ['analyst', 'risk', 'strategist', 'executor', 'reviewer'],
    db: { news: newsCount, analysis: analysisCount, strategies: db.prepare('SELECT COUNT(*) as cnt FROM strategies WHERE status = ?').get('active').cnt },
    ws: { connected: wsConnected, pairs: PRICE_PAIRS, prices: Object.fromEntries(PRICE_PAIRS.map(p => [p, priceCache[p]?.price || 0])) },
    crucix: CRUCIX,
    llm: LLM_MODEL,
    uptime_s: Math.round(process.uptime()),
  });
});

app.get('/api/observability', (req, res) => {
  const agents = {};
  for (const [name, m] of Object.entries(agentMetrics)) {
    agents[name] = {
      calls: m.calls,
      errors: m.errors,
      error_rate: m.calls > 0 ? ((m.errors / m.calls) * 100).toFixed(1) + '%' : '0%',
      avg_ms: m.calls > 0 ? Math.round(m.total_ms / m.calls) : 0,
      avg_tokens: m.calls > 0 ? Math.round(m.total_tokens / m.calls) : 0,
      total_tokens: m.total_tokens,
      last_run: m.last_run,
    };
  }
  const signalScoreCount = db.prepare('SELECT COUNT(*) as cnt FROM signal_scores').get().cnt;
  const lessonsActive = db.prepare('SELECT COUNT(*) as cnt FROM lessons WHERE active = 1').get().cnt;
  const candleCount = db.prepare('SELECT COUNT(*) as cnt FROM candles').get().cnt;
  const lastWeekly = db.prepare("SELECT timestamp FROM decisions WHERE agent = 'reviewer' AND action = 'weekly_review' ORDER BY timestamp DESC LIMIT 1").get();

  res.json({
    agents,
    models: AGENT_MODELS,
    learning_loop: {
      candles_stored: candleCount,
      signals_scored: signalScoreCount,
      active_lessons: lessonsActive,
      source_weights: getSourceWeights(),
      last_weekly_review: lastWeekly?.timestamp || null,
    },
    uptime_s: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

// Force refresh
app.post('/api/refresh', async (req, res) => {
  const anyAnalyzing = cache.crypto.analyzing || cache.stock.analyzing;
  if (anyAnalyzing) return res.json({ status: 'already_running' });
  collectAndAnalyze();
  res.json({ status: 'started' });
});

// --- History Routes ---

app.get('/api/history/news', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare('SELECT * FROM news ORDER BY fetched_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM news').get().cnt;
  res.json({ data: rows, total, limit, offset });
});

app.get('/api/history/analysis', (req, res) => {
  const mode = req.query.mode === 'stock' ? 'stock' : 'crypto';
  const limit = Math.min(parseInt(req.query.limit) || 24, 200);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare('SELECT * FROM analysis WHERE mode = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(mode, limit, offset);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM analysis WHERE mode = ?').get(mode).cnt;
  // Parse result_json back to object
  const data = rows.map(r => ({ ...r, result_json: JSON.parse(r.result_json || '{}') }));
  res.json({ data, total, limit, offset, mode });
});

app.get('/api/history/patrol', (req, res) => {
  const mode = req.query.mode;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const offset = parseInt(req.query.offset) || 0;
  let rows, total;
  if (mode) {
    rows = db.prepare('SELECT * FROM patrol_reports WHERE mode = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(mode, limit, offset);
    total = db.prepare('SELECT COUNT(*) as cnt FROM patrol_reports WHERE mode = ?').get(mode).cnt;
  } else {
    rows = db.prepare('SELECT * FROM patrol_reports ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    total = db.prepare('SELECT COUNT(*) as cnt FROM patrol_reports').get().cnt;
  }
  res.json({ data: rows, total, limit, offset });
});

// --- Trade & Decision Recording ---

app.post('/api/trades', (req, res) => {
  const t = req.body;
  if (!t.trade_id || !t.side) return res.status(400).json({ error: 'trade_id and side required' });
  try {
    insertTrade.run(
      t.trade_id, t.source || 'onchain', t.pair || 'WETH/USDC', t.side,
      t.entry_price || 0, t.amount || 0, t.amount_out || 0,
      t.status || 'open', t.tx_hash || '',
      t.signal_snapshot ? JSON.stringify(t.signal_snapshot) : null,
      t.decision_reasoning || '', t.opened_at || new Date().toISOString()
    );
    res.json({ success: true, trade_id: t.trade_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trades/:tradeId/close', (req, res) => {
  const { tradeId } = req.params;
  const { exit_price, pnl, pnl_pct } = req.body;
  try {
    updateTradeClose.run(exit_price || 0, pnl || 0, pnl_pct || 0, new Date().toISOString(), tradeId);
    res.json({ success: true, trade_id: tradeId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trades', (req, res) => {
  const status = req.query.status; // 'open' | 'closed' | undefined (all)
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  let rows, total;
  if (status) {
    rows = db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY opened_at DESC LIMIT ? OFFSET ?').all(status, limit, offset);
    total = db.prepare('SELECT COUNT(*) as cnt FROM trades WHERE status = ?').get(status).cnt;
  } else {
    rows = db.prepare('SELECT * FROM trades ORDER BY opened_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    total = db.prepare('SELECT COUNT(*) as cnt FROM trades').get().cnt;
  }
  res.json({ data: rows, total, limit, offset });
});

app.get('/api/trades/stats', (req, res) => {
  const closed = db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY closed_at DESC').all('closed');
  const open = db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY opened_at DESC').all('open');

  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl <= 0);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  // Max drawdown: running max peak - current equity
  let peak = 0, maxDrawdown = 0, equity = 0;
  for (const t of closed.slice().reverse()) {
    equity += t.pnl || 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  res.json({
    total_trades: closed.length,
    open_trades: open.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) + '%' : 'N/A',
    total_pnl: Number(totalPnl.toFixed(4)),
    avg_win: Number(avgWin.toFixed(4)),
    avg_loss: Number(avgLoss.toFixed(4)),
    profit_factor: Number(profitFactor.toFixed(2)),
    max_drawdown: Number(maxDrawdown.toFixed(4)),
    open_positions: open.map(t => ({ trade_id: t.trade_id, pair: t.pair, side: t.side, amount: t.amount, entry_price: t.entry_price })),
    recent_closed: closed.slice(0, 10).map(t => ({
      trade_id: t.trade_id, pair: t.pair, side: t.side, pnl: t.pnl, pnl_pct: t.pnl_pct,
      entry_price: t.entry_price, exit_price: t.exit_price, opened_at: t.opened_at, closed_at: t.closed_at,
    })),
  });
});

app.post('/api/decisions', (req, res) => {
  const d = req.body;
  if (!d.action) return res.status(400).json({ error: 'action required' });
  try {
    insertDecision.run(
      d.timestamp || new Date().toISOString(), d.agent || 'sentinel', d.action,
      d.tool_name || '', d.tool_args ? JSON.stringify(d.tool_args) : '',
      d.tool_result ? JSON.stringify(d.tool_result) : '',
      d.input_summary || '', d.output_summary || '',
      d.reasoning || '', d.confidence || 0, d.trade_id || null
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/decisions/batch', (req, res) => {
  const items = req.body.decisions;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'decisions array required' });
  const batchInsert = db.transaction((list) => {
    for (const d of list) {
      insertDecision.run(
        d.timestamp || new Date().toISOString(), d.agent || 'sentinel', d.action || 'tool_call',
        d.tool_name || '', d.tool_args ? JSON.stringify(d.tool_args) : '',
        d.tool_result ? JSON.stringify(d.tool_result) : '',
        d.input_summary || '', d.output_summary || '',
        d.reasoning || '', d.confidence || 0, d.trade_id || null
      );
    }
  });
  try { batchInsert(items); res.json({ success: true, count: items.length }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/decisions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const tradeId = req.query.trade_id;
  let rows, total;
  if (tradeId) {
    rows = db.prepare('SELECT * FROM decisions WHERE trade_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(tradeId, limit, offset);
    total = db.prepare('SELECT COUNT(*) as cnt FROM decisions WHERE trade_id = ?').get(tradeId).cnt;
  } else {
    rows = db.prepare('SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
    total = db.prepare('SELECT COUNT(*) as cnt FROM decisions').get().cnt;
  }
  res.json({ data: rows, total, limit, offset });
});

// --- Learning Loop Routes ---

app.get('/api/signal-accuracy', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const byAction = db.prepare(`
    SELECT recommended_action, COUNT(*) as total,
      SUM(CASE WHEN correct_1h = 1 THEN 1 ELSE 0 END) as correct_1h,
      SUM(CASE WHEN correct_4h = 1 THEN 1 ELSE 0 END) as correct_4h,
      AVG(confidence) as avg_confidence
    FROM signal_scores WHERE scored_at > ? GROUP BY recommended_action
  `).all(since);
  const overall = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN correct_1h = 1 THEN 1 ELSE 0 END) as correct_1h,
      SUM(CASE WHEN correct_4h = 1 THEN 1 ELSE 0 END) as correct_4h
    FROM signal_scores WHERE scored_at > ?
  `).get(since);
  res.json({ days, overall, by_action: byAction, source_weights: getSourceWeights() });
});

app.get('/api/lessons', (req, res) => {
  const active = req.query.active !== 'false';
  const rows = active
    ? db.prepare('SELECT * FROM lessons WHERE active = 1 ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM lessons ORDER BY created_at DESC LIMIT 50').all();
  res.json({ data: rows, count: rows.length });
});

// --- Market Scanner & Technical Analysis ---

async function scanMarketOpportunities() {
  if (!BITGET_API_KEY) return;
  console.log('[Scanner] Scanning futures market...');

  try {
    // 1. Get all futures tickers
    const tickers = await bitgetPublic('/api/v2/mix/market/tickers?productType=USDT-FUTURES');
    if (!tickers?.length) return;

    // 2. Filter: volume > $5M, meaningful move
    const candidates = tickers.filter(t => {
      const vol = parseFloat(t.usdtVolume || 0);
      const chg = Math.abs(parseFloat(t.change24h || 0));
      return vol > 5000000 && chg > 0.02;
    }).map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPr),
      change24h: parseFloat(t.change24h),
      volume: parseFloat(t.usdtVolume),
      fundingRate: parseFloat(t.fundingRate || 0),
      high24h: parseFloat(t.high24h),
      low24h: parseFloat(t.low24h),
    })).sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));

    // 3. For top 10 candidates, fetch 1h candles and compute indicators
    const opportunities = [];
    for (const c of candidates.slice(0, 10)) {
      try {
        const candles = await bitgetPublic(`/api/v2/mix/market/candles?symbol=${c.symbol}&productType=USDT-FUTURES&granularity=1H&limit=50`);
        if (!candles?.length) continue;

        // Parse candles: [ts, open, high, low, close, vol, quoteVol]
        const closes = candles.map(k => parseFloat(k[4])).reverse(); // oldest first
        const highs = candles.map(k => parseFloat(k[2])).reverse();
        const lows = candles.map(k => parseFloat(k[3])).reverse();

        // RSI (14)
        const rsi = calcRSI(closes, 14);
        // MA20, MA50
        const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((s, v) => s + v, 0) / 20 : null;
        const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((s, v) => s + v, 0) / 50 : null;
        // Bollinger Bands (20, 2)
        const bb = calcBollinger(closes, 20);
        // Support & Resistance (recent swing lows/highs)
        const support = Math.min(...lows.slice(-20));
        const resistance = Math.max(...highs.slice(-20));

        opportunities.push({
          ...c,
          rsi,
          ma20,
          ma50,
          bb,
          support,
          resistance,
          signal: rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'neutral',
          trend: ma20 && ma50 ? (ma20 > ma50 ? 'bullish' : 'bearish') : 'unknown',
        });
      } catch {}
    }

    // 4. Check margin + pending orders before trading
    let availableMargin = 0;
    let totalEquity = 0;
    try {
      const accts = await bitgetRequest('GET', '/api/v2/mix/account/accounts?productType=USDT-FUTURES');
      const usdt = (accts || []).find(a => a.marginCoin === 'USDT');
      availableMargin = parseFloat(usdt?.crossedMaxAvailable || usdt?.available || '0');
      totalEquity = parseFloat(usdt?.accountEquity || '0');
    } catch {}

    // If margin locked by pending orders, cancel them to free up for potentially better trades
    if (availableMargin < 2.0 && totalEquity >= 2.0) {
      console.log(`[Scanner] Margin locked ($${availableMargin.toFixed(2)} avail / $${totalEquity.toFixed(2)} equity). Checking pending orders...`);
      try {
        const pendingData = await bitgetRequest('GET', '/api/v2/mix/order/orders-pending?productType=USDT-FUTURES');
        const pendingOrders = pendingData?.entrustedList || (Array.isArray(pendingData) ? pendingData : []);
        if (pendingOrders.length > 0) {
          console.log(`[Scanner] Found ${pendingOrders.length} pending order(s). Cancelling to free margin for new opportunities...`);
          for (const order of pendingOrders) {
            try {
              await bitgetRequest('POST', '/api/v2/mix/order/cancel-order', {
                symbol: order.symbol, productType: 'USDT-FUTURES', orderId: order.orderId,
              });
              console.log(`[Scanner] Cancelled ${order.symbol} ${order.side} @ ${order.price} (orderId: ${order.orderId})`);
            } catch (e) { console.error(`[Scanner] Cancel failed:`, e.message); }
          }
          // Re-check available margin after cancellation
          await new Promise(r => setTimeout(r, 1000));
          const accts2 = await bitgetRequest('GET', '/api/v2/mix/account/accounts?productType=USDT-FUTURES');
          const usdt2 = (accts2 || []).find(a => a.marginCoin === 'USDT');
          availableMargin = parseFloat(usdt2?.crossedMaxAvailable || usdt2?.available || '0');
          console.log(`[Scanner] After cancel: available margin $${availableMargin.toFixed(2)}`);
        }
      } catch (e) { console.error('[Scanner] Pending order check failed:', e.message); }
    }

    if (availableMargin < 2.0) {
      console.log(`[Scanner] Skip trading: available margin $${availableMargin.toFixed(2)} < $2.00`);
    } else if (opportunities.length > 0) {
      await runTechnicalTrading(opportunities);
    }

    console.log(`[Scanner] Found ${opportunities.length} opportunities from ${candidates.length} candidates`);
  } catch (err) {
    console.error('[Scanner] Error:', err.message);
  }
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  // Seed with SMA over first `period` bars
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Wilder's smoothing for remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

function calcBollinger(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const ma = slice.reduce((s, v) => s + v, 0) / period;
  const stddev = Math.sqrt(slice.reduce((s, v) => s + (v - ma) ** 2, 0) / period);
  return { upper: ma + 2 * stddev, middle: ma, lower: ma - 2 * stddev };
}

async function runTechnicalTrading(opportunities) {
  const traceId = `tech_${Date.now()}`;
  const prompt = `You are RIFI's Technical Trading Agent. Analyze these opportunities and decide which ones to trade.

Available balance: ~$2.7 USDT in Bitget futures. Use 10x leverage. Pick only 1 best setup and go all-in with full balance.

Opportunities (sorted by 24h move):
${JSON.stringify(opportunities, null, 2)}

Rules:
- Pick ONLY 1 best setup — go all-in, you have very limited capital
- Prefer: RSI oversold (<30) for longs, RSI overbought (>70) for shorts
- Use limit orders at support/resistance levels, NOT market orders
- Set tight stop-loss (2-3% from entry for 10x = 20-30% account risk)
- Position size: use 2.0-2.5 USDT margin (nearly full balance). Bitget min order is usually ~5 USDT notional, so with 10x leverage 2.5 USDT margin = $25 notional.
- Prefer coins with high volume and extreme funding rates (arb potential)
- If nothing looks good, respond with empty trades array

Respond with JSON:
{
  "analysis": "<Chinese 2-3 sentence market overview>",
  "trades": [
    {
      "symbol": "XXXUSDT",
      "side": "buy|sell",
      "size": "<min contract size>",
      "orderType": "limit",
      "price": "<entry price at support/resistance>",
      "stopLoss": "<price>",
      "takeProfit": "<price>",
      "reason": "<Chinese one-line reason>"
    }
  ]
}`;

  try {
    const result = await runAgent('executor', prompt, [], {}, 'Execute technical analysis trades', {
      trace_id: traceId, max_tokens: 800, timeout: 30000, model: AGENT_MODELS.analyst,
    });

    let parsed;
    try {
      const jsonStr = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.warn('[TechTrading] Parse failed:', result.content.slice(0, 100));
      return;
    }

    console.log(`[TechTrading] ${parsed.trades?.length || 0} trades proposed: ${parsed.analysis?.slice(0, 80)}`);

    // Execute each trade
    for (const trade of (parsed.trades || [])) {
      try {
        // Set leverage
        const holdSide = trade.side === 'buy' ? 'long' : 'short';
        await bitgetRequest('POST', '/api/v2/mix/account/set-leverage', {
          symbol: trade.symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT',
          leverage: '10', holdSide,
        }).catch(() => {});

        // Calculate proper size in contracts
        // Bitget size = number of contracts. Notional = size * price. Margin = notional / leverage.
        // We want to use ~$2.5 margin with 10x leverage = $25 notional. size = 25 / price.
        const entryPrice = parseFloat(trade.price) || parseFloat(trade.size) || 1;
        const targetNotional = 25; // $2.5 margin * 10x leverage
        let contractSize = Math.max(1, Math.round(targetNotional / entryPrice));
        // For high-price assets (BTC, ETH), size is in base units (e.g. 0.001 BTC)
        if (entryPrice > 100) contractSize = Math.max(parseFloat(trade.size) || 1, +(targetNotional / entryPrice).toFixed(4));
        const finalSize = String(contractSize);
        console.log(`[TechTrading] ${trade.symbol} size calc: price=${entryPrice} targetNotional=${targetNotional} → size=${finalSize}`);

        // Place limit order
        const order = await bitgetRequest('POST', '/api/v2/mix/order/place-order', {
          symbol: trade.symbol, productType: 'USDT-FUTURES', marginMode: 'crossed',
          marginCoin: 'USDT', side: trade.side, tradeSide: 'open',
          orderType: trade.orderType || 'limit', size: finalSize,
          ...(trade.price ? { price: String(trade.price) } : {}),
        });

        console.log(`[TechTrading] ${holdSide.toUpperCase()} ${trade.symbol} @ ${trade.price || 'market'} | orderId: ${order?.orderId}`);

        // Set TP/SL if provided
        if (trade.stopLoss || trade.takeProfit) {
          try {
            await bitgetRequest('POST', '/api/v2/mix/order/place-tpsl-order', {
              symbol: trade.symbol, productType: 'USDT-FUTURES', marginMode: 'crossed',
              planType: 'pos_profit', triggerPrice: String(trade.takeProfit || '0'),
              triggerType: 'mark_price', holdSide,
            }).catch(() => {});
            await bitgetRequest('POST', '/api/v2/mix/order/place-tpsl-order', {
              symbol: trade.symbol, productType: 'USDT-FUTURES', marginMode: 'crossed',
              planType: 'pos_loss', triggerPrice: String(trade.stopLoss || '0'),
              triggerType: 'mark_price', holdSide,
            }).catch(() => {});
          } catch {}
        }

        insertDecision.run(new Date().toISOString(), 'executor', 'tech_trade', 'limit-order',
          JSON.stringify(trade), JSON.stringify(order), `Tech: ${trade.reason}`, '', '', 0, `bg_${order?.orderId}`);

      } catch (err) {
        console.error(`[TechTrading] ${trade.symbol} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[TechTrading] Agent error:', err.message);
  }
}

// --- Bitget Routes ---

app.get('/api/bitget/balance', async (req, res) => {
  try {
    const [spot, futures] = await Promise.all([
      bitgetRequest('GET', '/api/v2/spot/account/assets'),
      bitgetRequest('GET', '/api/v2/mix/account/accounts?productType=USDT-FUTURES').catch(() => []),
    ]);
    const spotBalances = (spot || []).filter(a => parseFloat(a.available) > 0);
    const futuresBalances = (futures || []).map(a => ({
      coin: a.marginCoin, equity: a.accountEquity, available: a.crossedMaxAvailable || a.available,
      unrealizedPL: a.unrealizedPL || '0',
    }));
    res.json({ spot: spotBalances, futures: futuresBalances });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bitget/ticker', async (req, res) => {
  const symbol = req.query.symbol || 'BTCUSDT';
  try {
    const data = await bitgetPublic(`/api/v2/spot/market/tickers?symbol=${symbol}`);
    const t = data?.[0];
    if (!t) return res.json({ error: 'No ticker data' });
    res.json({ symbol: t.symbol, price: t.lastPr, change24h: t.change24h, high24h: t.high24h, low24h: t.low24h, volume24h: t.baseVolume });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bitget/spot-order', async (req, res) => {
  const { symbol, side, amount, price, orderType } = req.body;
  if (!symbol || !side || !amount) return res.status(400).json({ error: 'symbol, side, amount required' });
  try {
    const order = await bitgetRequest('POST', '/api/v2/spot/trade/place-order', {
      symbol, side, orderType: orderType || 'market', force: 'gtc',
      ...(orderType === 'limit' ? { price: String(price), size: String(amount) } : { size: String(amount) }),
    });
    console.log(`[Bitget] Spot ${side} ${amount} ${symbol}: orderId=${order?.orderId}`);
    res.json({ success: true, orderId: order?.orderId, symbol, side, amount });
  } catch (e) {
    console.error(`[Bitget] Spot order failed:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bitget/futures-order', async (req, res) => {
  const { symbol, side, amount, price, orderType, leverage, marginMode } = req.body;
  if (!symbol || !side || !amount) return res.status(400).json({ error: 'symbol, side, amount required' });
  try {
    // Set leverage if specified
    if (leverage) {
      await bitgetRequest('POST', '/api/v2/mix/account/set-leverage', {
        symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT',
        leverage: String(leverage), holdSide: side === 'buy' ? 'long' : 'short',
      }).catch(() => {});
    }
    const order = await bitgetRequest('POST', '/api/v2/mix/order/place-order', {
      symbol, productType: 'USDT-FUTURES', marginMode: marginMode || 'crossed', marginCoin: 'USDT',
      side: side === 'buy' ? 'buy' : 'sell',
      tradeSide: side === 'buy' ? 'open' : 'close',
      orderType: orderType || 'market', size: String(amount),
      ...(orderType === 'limit' ? { price: String(price) } : {}),
    });
    console.log(`[Bitget] Futures ${side} ${amount} ${symbol}: orderId=${order?.orderId}`);
    res.json({ success: true, orderId: order?.orderId, symbol, side, amount });
  } catch (e) {
    console.error(`[Bitget] Futures order failed:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/bitget/positions', async (req, res) => {
  try {
    const positions = await bitgetRequest('GET', '/api/v2/mix/position/all-position?productType=USDT-FUTURES');
    res.json({ positions: (positions || []).map(p => ({
      symbol: p.symbol, side: p.holdSide, size: p.total, avgPrice: p.averageOpenPrice,
      unrealizedPL: p.unrealizedPL, leverage: p.leverage, liquidationPrice: p.liquidationPrice,
    }))});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- LiFi Routes ---

app.post('/api/lifi-swap', async (req, res) => {
  const { from_chain, to_chain, from_token, to_token, amount } = req.body;
  if (!from_chain || !to_chain || !from_token || !to_token || !amount) {
    return res.status(400).json({ error: 'Missing required fields: from_chain, to_chain, from_token, to_token, amount' });
  }

  try {
    const result = await lifiSwap({ fromChain: from_chain, toChain: to_chain, fromToken: from_token, toToken: to_token, amount });

    // Return quote info (actual execution will go through SessionManager V2)
    res.json({
      status: 'quoted',
      from: `${amount} ${from_token} (${from_chain})`,
      to: `~${result.estimatedOutputFormatted} ${to_token} (${to_chain})`,
      tool: result.tool,
      estimated_output: result.estimatedOutputFormatted,
      lifi_target: result.transactionRequest?.to || LIFI_DIAMOND,
      session_manager: SESSION_MANAGER_V2,
      note: 'Execution goes through SessionManagerV2.executeCall() with budget constraints',
    });
  } catch (err) {
    console.error('[LiFi] Swap error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lifi-quote', async (req, res) => {
  const { from_chain, to_chain, from_token, to_token, amount } = req.query;
  if (!from_chain || !to_chain || !from_token || !to_token || !amount) {
    return res.status(400).json({ error: 'Missing query params' });
  }
  try {
    const result = await lifiSwap({ fromChain: from_chain, toChain: to_chain, fromToken: from_token, toToken: to_token, amount: String(amount) });
    res.json({
      from: `${amount} ${from_token} (${from_chain})`,
      to: `~${result.estimatedOutputFormatted} ${to_token} (${to_chain})`,
      tool: result.tool,
      fromChainId: result.fromChainId,
      toChainId: result.toChainId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Strategy Routes ---

app.get('/api/strategies', (req, res) => {
  const status = req.query.status || 'active';
  const rows = db.prepare('SELECT * FROM strategies WHERE status = ? ORDER BY created_at DESC').all(status);
  const data = rows.map(r => ({
    ...r,
    plan_json: r.plan_json ? JSON.parse(r.plan_json) : null,
    params_json: r.params_json ? JSON.parse(r.params_json) : null,
  }));
  res.json({ data, count: data.length });
});

app.post('/api/strategies', (req, res) => {
  const { goal, template, plan_json, params_json } = req.body;
  if (!goal) return res.status(400).json({ error: 'goal required' });
  try {
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO strategies (goal, template, plan_json, params_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(goal, template || 'custom', plan_json ? JSON.stringify(plan_json) : null,
      params_json ? JSON.stringify(params_json) : null, now, now);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/strategies/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { status, progress_pct, score, goal, plan_json, params_json } = req.body;
  const now = new Date().toISOString();
  const fields = [];
  const values = [];
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (progress_pct !== undefined) { fields.push('progress_pct = ?'); values.push(progress_pct); }
  if (score !== undefined) { fields.push('score = ?'); values.push(score); }
  if (goal !== undefined) { fields.push('goal = ?'); values.push(goal); }
  if (plan_json !== undefined) { fields.push('plan_json = ?'); values.push(JSON.stringify(plan_json)); }
  if (params_json !== undefined) { fields.push('params_json = ?'); values.push(JSON.stringify(params_json)); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  fields.push('updated_at = ?'); values.push(now);
  values.push(id);
  try {
    db.prepare(`UPDATE strategies SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Start ---

app.listen(PORT, () => {
  console.log(`[VPS-API] Running on :${PORT} | LLM: ${LLM_MODEL} | Modes: crypto + stock | DB: data/rifi.db`);
  collectAndAnalyze();
  setInterval(collectAndAnalyze, 15 * 60 * 1000);
  // Start OKX WebSocket price streaming
  connectOKXWebSocket();
  console.log(`[VPS-API] OKX WebSocket: subscribing to ${PRICE_PAIRS.join(', ')}`);
});
