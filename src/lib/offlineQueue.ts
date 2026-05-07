// Offline write queue — persists pending Supabase mutations in localStorage.
// When the app goes online, SyncProvider calls syncQueue() to flush all ops.
//
// Design decisions:
// - UUIDs are generated client-side for insert ops so the row has its final ID
//   before it ever reaches the server (no temp-id swap needed in local state).
// - Each op is processed independently — successful ops are removed even if
//   others fail, so a bad op doesn't block the whole queue forever.
// - Only supports the two mutation types used in the app: insert and update.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface QueuedOp {
  id: string                        // client-generated UUID for the queue entry
  table: string
  action: 'insert' | 'update' | 'upsert_toggle'
  payload: Record<string, unknown>  // columns to write
  filter?: { key: string; val: unknown }[]  // WHERE clauses (for update)
  ts: number                        // unix ms — used for ordering and debugging
}

const QUEUE_KEY = 'pos_offline_queue_v1'

function readQueue(): QueuedOp[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedOp[]
  } catch {
    return []
  }
}

function writeQueue(q: QueuedOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch { /* ignore */ }
}

// Add an operation to the queue.
export function enqueue(op: Omit<QueuedOp, 'id' | 'ts'>): void {
  const queue = readQueue()
  queue.push({ ...op, id: crypto.randomUUID(), ts: Date.now() })
  writeQueue(queue)
}

// How many ops are waiting to sync.
export function getPendingCount(): number {
  return readQueue().length
}

// Flush all queued operations to Supabase.
// Returns a summary of what happened.
export async function syncQueue(
  supabase: SupabaseClient
): Promise<{ synced: number; failed: number }> {
  const queue = readQueue()
  if (queue.length === 0) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0
  const failedOps: QueuedOp[] = []

  for (const op of queue) {
    try {
      if (op.action === 'insert') {
        const { error } = await supabase.from(op.table).insert(op.payload)
        if (error) throw error

      } else if (op.action === 'update' && op.filter) {
        // Apply all filter conditions (always a single .eq per update in this app)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = supabase.from(op.table).update(op.payload) as any
        for (const { key, val } of op.filter) {
          q = q.eq(key, val)
        }
        const { error } = await q
        if (error) throw error
      }

      synced++
    } catch (err) {
      console.error('[OfflineQueue] op failed:', op, err)
      failed++
      failedOps.push(op)
    }
  }

  // Only keep the ops that actually failed — successful ones are gone
  writeQueue(failedOps)
  return { synced, failed }
}
