// Signal Hub — 信号采集 + 分级 + 推送
// 只推 CRITICAL/HIGH，MEDIUM/LOW 静默记录

import { pushService, type SignalLevel, type PushEvent } from './push-service'

const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

interface RawSignal {
  timestamp: string
  macro_risk_score: number
  crypto_sentiment: number
  stock_sentiment?: number
  alerts: Array<{
    level: string
    signal: string
    source?: string
    relevance: number
  }>
  technical_bias: string
  recommended_action: string
  briefing?: string
  push_worthy?: boolean
  push_reason?: string
  mode?: string
}

// Signal log — MEDIUM/LOW go here silently
const signalLog: Array<{ timestamp: string; level: SignalLevel; signal: string }> = []
const MAX_LOG = 200

let isRunning = false
let intervalId: ReturnType<typeof setInterval> | null = null

export function startSignalHub(intervalMs = 60_000) {
  if (isRunning) return
  isRunning = true

  // First poll immediately
  pollSignals()

  intervalId = setInterval(pollSignals, intervalMs)
  console.log(`[SignalHub] Started, polling every ${intervalMs / 1000}s`)
}

export function stopSignalHub() {
  if (intervalId) clearInterval(intervalId)
  isRunning = false
  console.log('[SignalHub] Stopped')
}

export function isSignalHubRunning() {
  return isRunning
}

export function getSignalLog() {
  return signalLog.slice(-50)
}

async function pollSignals() {
  try {
    const res = await fetch(`${VPS_API}/api/signals`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return

    const data: RawSignal = await res.json()

    // Log all alerts
    for (const alert of data.alerts) {
      const level = classifyLevel(alert.level, alert.relevance)
      signalLog.push({ timestamp: data.timestamp, level, signal: alert.signal })
      if (signalLog.length > MAX_LOG) signalLog.shift()
    }

    // Push only when AI says push_worthy (FLASH-level events)
    if (data.push_worthy) {
      const event: PushEvent = {
        type: 'SIGNAL_ALERT',
        level: 'CRITICAL',
        data: {
          reason: data.push_reason || '',
          briefing: data.briefing || '',
          macro_risk_score: data.macro_risk_score,
          crypto_sentiment: data.crypto_sentiment,
          technical_bias: data.technical_bias,
          recommended_action: data.recommended_action,
        },
        timestamp: new Date().toISOString(),
      }
      pushService.broadcastAll(event)
    }
  } catch {
    // VPS not available — silent
  }
}

function classifyLevel(rawLevel: string, relevance: number): SignalLevel {
  if (relevance >= 85 || rawLevel === 'FLASH') return 'CRITICAL'
  if (relevance >= 70 || rawLevel === 'PRIORITY') return 'HIGH'
  if (relevance >= 50) return 'MEDIUM'
  return 'LOW'
}
