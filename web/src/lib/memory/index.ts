// AI Memory System — per-wallet persistent memory
// Original sections: profile (who), patterns (lessons), decisions (history)
// Enhanced sections: market_regime, strategy_feedback, risk_lesson, reference

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const MEMORY_DIR = join(process.cwd(), 'data', 'memory')

function walletDir(wallet: string): string {
  const dir = join(MEMORY_DIR, wallet.toLowerCase())
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// Original sections (backward compatible)
type Section = 'profile' | 'patterns' | 'decisions'
// Enhanced sections
type EnhancedSection = 'market_regime' | 'strategy_feedback' | 'risk_lesson' | 'reference'
export type AnySection = Section | EnhancedSection

// Decay config: how many days before entries expire (0 = never)
const DECAY_DAYS: Record<EnhancedSection, number> = {
  market_regime: 3,
  strategy_feedback: 30,
  risk_lesson: 0,      // permanent
  reference: 0,        // manual update only
}

function filePath(wallet: string, section: AnySection): string {
  return join(walletDir(wallet), `${section}.md`)
}

export function readMemory(wallet: string, section: AnySection): string {
  const path = filePath(wallet, section)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

export function writeMemory(wallet: string, section: AnySection, content: string, mode: 'overwrite' | 'append' = 'append') {
  const path = filePath(wallet, section)
  const timestamp = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const tagged = `[${timestamp}] ${content}`

  if (mode === 'append') {
    appendFileSync(path, '\n' + tagged, 'utf-8')
  } else {
    writeFileSync(path, tagged, 'utf-8')
  }
}

export function getAllMemory(wallet: string): string {
  const profile = readMemory(wallet, 'profile')
  const patterns = readMemory(wallet, 'patterns')
  const decisions = readMemory(wallet, 'decisions')

  // Enhanced sections (with decay applied)
  const regime = getValidEntries(wallet, 'market_regime')
  const feedback = getValidEntries(wallet, 'strategy_feedback')
  const riskLessons = readMemory(wallet, 'risk_lesson')
  const references = readMemory(wallet, 'reference')

  const parts: string[] = []
  if (profile) parts.push(`## User Profile\n${profile}`)
  if (patterns) parts.push(`## Trading Patterns & Lessons\n${patterns}`)
  if (decisions) parts.push(`## Past Decisions\n${decisions}`)
  if (regime) parts.push(`## Current Market Regime\n${regime}`)
  if (feedback) parts.push(`## Strategy Feedback\n${feedback}`)
  if (riskLessons) parts.push(`## Risk Lessons (Permanent)\n${riskLessons}`)
  if (references) parts.push(`## References\n${references}`)

  return parts.length > 0 ? parts.join('\n\n') : ''
}

// Get entries filtered by decay window
function getValidEntries(wallet: string, section: EnhancedSection): string {
  const raw = readMemory(wallet, section)
  if (!raw) return ''

  const decayDays = DECAY_DAYS[section]
  if (decayDays === 0) return raw // no decay

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - decayDays)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  // Filter lines: keep entries with date >= cutoff
  const lines = raw.split('\n').filter(line => {
    const dateMatch = line.match(/^\[(\d{4}-\d{2}-\d{2})\]/)
    if (!dateMatch) return true // keep non-dated lines
    return dateMatch[1] >= cutoffStr
  })

  return lines.join('\n').trim()
}

// List all memory sections that have content for a wallet
export function listMemorySections(wallet: string): AnySection[] {
  const dir = walletDir(wallet)
  const sections: AnySection[] = []
  const allSections: AnySection[] = ['profile', 'patterns', 'decisions', 'market_regime', 'strategy_feedback', 'risk_lesson', 'reference']

  for (const section of allSections) {
    const path = join(dir, `${section}.md`)
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8').trim()
      if (content) sections.push(section)
    }
  }

  return sections
}

// Prune expired entries from a section (actually removes them from file)
export function pruneExpiredEntries(wallet: string, section: EnhancedSection): number {
  const raw = readMemory(wallet, section)
  if (!raw) return 0

  const decayDays = DECAY_DAYS[section]
  if (decayDays === 0) return 0

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - decayDays)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const lines = raw.split('\n')
  const validLines = lines.filter(line => {
    const dateMatch = line.match(/^\[(\d{4}-\d{2}-\d{2})\]/)
    if (!dateMatch) return true
    return dateMatch[1] >= cutoffStr
  })

  const pruned = lines.length - validLines.length
  if (pruned > 0) {
    writeFileSync(filePath(wallet, section), validLines.join('\n'), 'utf-8')
  }
  return pruned
}
