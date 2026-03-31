// Task manager — create, track, and query background tasks

import { JsonStore } from './store'
import type { Task, TaskType, TaskStatus } from './types'

const store = new JsonStore<Task>('tasks.json')

// High-water mark: find max numeric suffix across all existing task IDs
let idCounter = store.getAll().reduce((max, t) => {
  const num = parseInt(t.id.split('_').pop() || '0')
  return Math.max(max, isNaN(num) ? 0 : num)
}, 0)

function generateId(type: TaskType): string {
  const prefix = type.charAt(0) // o=order_monitor, s=signal_poll, p=patrol, etc.
  return `${prefix}_${Date.now()}_${++idCounter}`
}

export function createTask(type: TaskType, label: string, metadata?: Record<string, unknown>): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: generateId(type),
    type,
    status: 'pending',
    label,
    createdAt: now,
    updatedAt: now,
    metadata,
  }
  store.set(task)
  return task
}

export function startTask(id: string): Task | undefined {
  return store.update(id, {
    status: 'running' as TaskStatus,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

export function completeTask(id: string, result?: Record<string, unknown>): Task | undefined {
  return store.update(id, {
    status: 'completed' as TaskStatus,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result,
  })
}

export function failTask(id: string, error: string): Task | undefined {
  return store.update(id, {
    status: 'failed' as TaskStatus,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error,
  })
}

export function cancelTask(id: string): Task | undefined {
  return store.update(id, {
    status: 'cancelled' as TaskStatus,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

export function getTask(id: string): Task | undefined {
  return store.get(id)
}

export function listTasks(filter?: { type?: TaskType; status?: TaskStatus }): Task[] {
  let tasks = store.getAll()
  if (filter?.type) tasks = tasks.filter(t => t.type === filter.type)
  if (filter?.status) tasks = tasks.filter(t => t.status === filter.status)
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getRunningTasks(): Task[] {
  return store.filter(t => t.status === 'running')
}

// Clean up old completed/failed tasks (keep last N)
export function pruneOldTasks(keepLast = 100) {
  const terminal = store.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
  const sorted = terminal.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  for (const task of sorted.slice(keepLast)) {
    store.delete(task.id)
  }
}
