// Task management API
// GET /api/tasks?type=order_monitor&status=running — list tasks
// POST /api/tasks — create task
// PATCH /api/tasks — update task status

import { NextRequest } from 'next/server'
import { listTasks, getTask, createTask, startTask, completeTask, failTask, cancelTask } from '@/lib/tasks'
import type { TaskType, TaskStatus } from '@/lib/tasks'

const AUTO_TRADE_SECRET = process.env.AUTO_TRADE_SECRET || 'rifi-auto-2026'

function checkAuth(req: NextRequest): Response | null {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${AUTO_TRADE_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') as TaskType | null
  const status = searchParams.get('status') as TaskStatus | null
  const id = searchParams.get('id')

  if (id) {
    const task = getTask(id)
    if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
    return Response.json(task)
  }

  const filter: { type?: TaskType; status?: TaskStatus } = {}
  if (type) filter.type = type
  if (status) filter.status = status

  const tasks = listTasks(filter)
  return Response.json({ tasks, count: tasks.length })
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({}))
  const { type, label, metadata } = body

  if (!type || !label) {
    return Response.json({ error: 'type and label required' }, { status: 400 })
  }

  const task = createTask(type, label, metadata)
  return Response.json(task, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const authErr = checkAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({}))
  const { id, action, error, result } = body

  if (!id || !action) {
    return Response.json({ error: 'id and action required' }, { status: 400 })
  }

  let task
  switch (action) {
    case 'start':
      task = startTask(id)
      break
    case 'complete':
      task = completeTask(id, result)
      break
    case 'fail':
      task = failTask(id, error || 'Unknown error')
      break
    case 'cancel':
      task = cancelTask(id)
      break
    default:
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
  return Response.json(task)
}
