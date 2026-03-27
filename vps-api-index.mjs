import express from 'express';
import { readFileSync } from 'fs';

const envLines = readFileSync('.env', 'utf-8').split('\n');
for (const line of envLines) {
  const [k, ...v] = line.split('=');
  if (k && v.length) process.env[k.trim()] = v.join('=').trim();
}

const app = express();
const PORT = process.env.PORT || 3200;
const CRUCIX = process.env.CRUCIX_URL || 'http://localhost:3117';
const LLM_BASE = process.env.LLM_BASE_URL || 'http://localhost:8080/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-5.4-mini-low-fast';
const LLM_KEY = process.env.LLM_API_KEY || 'pwd';
const NEWS_TOKEN = process.env.OPENNEWS_TOKEN;
const NEWS_API = 'https://ai.6551.io';

let analysisCache = null;
let lastUpdate = null;
let analyzing = false;

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

// --- AI Analysis (replaces rule engine) ---

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

async function runFullAnalysis(crucix, news) {
  if (analyzing) return;
  analyzing = true;

  const crucixSummary = compactCrucix(crucix);
  const newsSummary = compactNews(news);
  const now = new Date().toISOString();

  const prompt = `You are a senior crypto trading intelligence analyst. Analyze the following real-time data and produce a structured JSON report.

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

  try {
    const result = await llm([{ role: 'user', content: prompt }], { max_tokens: 1000, timeout: 30000 });
    let parsed;
    try {
      const jsonStr = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('[Analysis] JSON parse failed, raw:', result.content.slice(0, 200));
      analyzing = false;
      return;
    }

    analysisCache = {
      ...parsed,
      timestamp: now,
      raw_sources: { crucix: !!crucix, news: Array.isArray(news) ? news.length : 0 },
      llm_meta: { model: result.model, duration_s: result.duration_s, tokens: result.tokens },
    };
    lastUpdate = now;
    console.log(`[${now}] Analysis complete (${result.duration_s}s) | Risk:${parsed.macro_risk_score} Sentiment:${parsed.crypto_sentiment} Bias:${parsed.technical_bias} Action:${parsed.recommended_action} Push:${parsed.push_worthy}`);
  } catch (err) {
    console.error('[Analysis] Error:', err.message);
  }
  analyzing = false;
}

// --- Collect & Analyze ---

async function collectAndAnalyze() {
  console.log(`[${new Date().toISOString()}] Collecting data...`);
  const [crucix, news] = await Promise.all([fetchCrucix(), fetchNews()]);
  console.log(`[${new Date().toISOString()}] Data collected. Crucix:${!!crucix} News:${Array.isArray(news) ? news.length : 0}. Running AI analysis...`);
  await runFullAnalysis(crucix, news);
}

// --- Routes ---

app.get('/api/signals', (req, res) => {
  if (!analysisCache) return res.json({ error: 'First analysis in progress.' });
  res.json(analysisCache);
});

app.get('/api/analysis', async (req, res) => {
  if (!analysisCache) return res.json({ error: 'Not ready.' });
  res.json({ token: req.query.token || 'ETH', ...analysisCache, last_update: lastUpdate });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    last_update: lastUpdate,
    analysis_cached: !!analysisCache,
    push_worthy: analysisCache?.push_worthy || false,
    crucix: CRUCIX,
    llm: LLM_MODEL,
    uptime_s: Math.round(process.uptime()),
  });
});

// Force refresh
app.post('/api/refresh', async (req, res) => {
  if (analyzing) return res.json({ status: 'already_running' });
  collectAndAnalyze();
  res.json({ status: 'started' });
});

app.listen(PORT, () => {
  console.log(`[VPS-API] Running on :${PORT} | LLM: ${LLM_MODEL}`);
  collectAndAnalyze();
  setInterval(collectAndAnalyze, 15 * 60 * 1000);
});
