// AI Memory System — per-wallet persistent memory
// Stores: profile (who), patterns (lessons), decisions (history)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const MEMORY_DIR = join(process.cwd(), 'data', 'memory')

function walletDir(wallet: string): string {
  const dir = join(MEMORY_DIR, wallet.toLowerCase())
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

type Section = 'profile' | 'patterns' | 'decisions'

function filePath(wallet: string, section: Section): string {
  return join(walletDir(wallet), `${section}.md`)
}

export function readMemory(wallet: string, section: Section): string {
  const path = filePath(wallet, section)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

export function writeMemory(wallet: string, section: Section, content: string, mode: 'overwrite' | 'append' = 'append') {
  const path = filePath(wallet, section)
  if (mode === 'append') {
    const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
    writeFileSync(path, existing + '\n' + content, 'utf-8')
  } else {
    writeFileSync(path, content, 'utf-8')
  }
}

export function getAllMemory(wallet: string): string {
  const profile = readMemory(wallet, 'profile')
  const patterns = readMemory(wallet, 'patterns')
  const decisions = readMemory(wallet, 'decisions')

  const parts: string[] = []
  if (profile) parts.push(`## User Profile\n${profile}`)
  if (patterns) parts.push(`## Trading Patterns & Lessons\n${patterns}`)
  if (decisions) parts.push(`## Past Decisions\n${decisions}`)

  return parts.length > 0 ? parts.join('\n\n') : ''
}
