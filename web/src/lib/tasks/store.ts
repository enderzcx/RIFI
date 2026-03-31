// JSON file store — lightweight persistence for tasks and orders
// No external dependencies. Atomic writes via rename. Debounced to avoid I/O storms.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), 'data')

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export class JsonStore<T extends { id: string | number }> {
  private filePath: string
  private cache: Map<string | number, T> = new Map()
  private dirty = false
  private loadFailed = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private readonly SAVE_DEBOUNCE_MS = 100

  constructor(filename: string) {
    ensureDir(DATA_DIR)
    this.filePath = join(DATA_DIR, filename)
    this.load()
  }

  private load() {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const items: T[] = JSON.parse(raw)
        for (const item of items) {
          this.cache.set(item.id, item)
        }
      }
    } catch (err) {
      console.error(`[Store] Failed to load ${this.filePath}:`, err)
      // Backup corrupted file instead of silently losing data
      try {
        renameSync(this.filePath, `${this.filePath}.corrupted.${Date.now()}`)
        console.error(`[Store] Corrupted file backed up as .corrupted`)
      } catch {}
      this.loadFailed = true
    }
  }

  private scheduleSave() {
    if (!this.dirty) return
    if (this.loadFailed) {
      console.error(`[Store] Refusing to save: initial load failed for ${this.filePath}`)
      return
    }
    // Debounce: batch rapid mutations into one write
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.persistToDisk()
    }, this.SAVE_DEBOUNCE_MS)
  }

  private persistToDisk() {
    if (!this.dirty) return
    try {
      const tmpPath = this.filePath + '.tmp'
      writeFileSync(tmpPath, JSON.stringify(Array.from(this.cache.values()), null, 2))
      renameSync(tmpPath, this.filePath)
      this.dirty = false
    } catch (err) {
      console.error(`[Store] Failed to save ${this.filePath}:`, err)
    }
  }

  get(id: string | number): T | undefined {
    return this.cache.get(id)
  }

  getAll(): T[] {
    return Array.from(this.cache.values())
  }

  filter(fn: (item: T) => boolean): T[] {
    return this.getAll().filter(fn)
  }

  set(item: T): void {
    this.cache.set(item.id, item)
    this.dirty = true
    this.scheduleSave()
  }

  update(id: string | number, patch: Partial<T>): T | undefined {
    const existing = this.cache.get(id)
    if (!existing) return undefined
    const updated = { ...existing, ...patch }
    this.cache.set(id, updated)
    this.dirty = true
    this.scheduleSave()
    return updated
  }

  delete(id: string | number): boolean {
    const deleted = this.cache.delete(id)
    if (deleted) {
      this.dirty = true
      this.scheduleSave()
    }
    return deleted
  }

  // Force immediate save (for shutdown hooks)
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.persistToDisk()
  }

  get size(): number {
    return this.cache.size
  }
}
