// Task system types

export type TaskType =
  | 'order_monitor'    // event-indexer polling
  | 'signal_poll'      // signal hub polling
  | 'patrol'           // VPS patrol cycle
  | 'backtest'         // historical strategy test
  | 'coordinator'      // multi-agent coordinator run
  | 'custom'           // user-defined

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Task {
  id: string
  type: TaskType
  status: TaskStatus
  label: string                    // human-readable description
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  result?: Record<string, unknown>
  metadata?: Record<string, unknown>
}
