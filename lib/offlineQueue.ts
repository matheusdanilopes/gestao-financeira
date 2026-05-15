/**
 * Fila offline para a lista de mercado.
 * Armazena operações pendentes em localStorage para sobreviver ao fechamento do app.
 */

const QUEUE_KEY = 'lm-offline-queue'
const TEMP_MAP_KEY = 'lm-tempid-map'
const MAX_OPS = 200
const MAX_RETRIES = 10

export type OpType = 'create' | 'update' | 'delete'

export interface PendingOp {
  opId: string
  type: OpType
  itemId: string
  payload?: Record<string, unknown>
  timestamp: number
  retries: number
}

// ── Queue ──────────────────────────────────────────────────────────────────────

function loadQueue(): PendingOp[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as PendingOp[]) : []
  } catch { return [] }
}

function saveQueue(ops: PendingOp[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(ops)) } catch { /* noop */ }
}

export function enqueueOp(op: Omit<PendingOp, 'opId' | 'retries'>): void {
  const ops = loadQueue()
  if (ops.length >= MAX_OPS) ops.splice(0, ops.length - MAX_OPS + 1)
  ops.push({ ...op, opId: crypto.randomUUID(), retries: 0 })
  saveQueue(ops)
}

export function dequeueOp(opId: string): void {
  saveQueue(loadQueue().filter(op => op.opId !== opId))
}

export function getAllOps(): PendingOp[] {
  return loadQueue()
}

export function pendingOpsCount(): number {
  return loadQueue().length
}

export function clearOpsForItem(itemId: string): void {
  saveQueue(loadQueue().filter(op => op.itemId !== itemId))
}

export function incrementOpRetries(opId: string): void {
  const ops = loadQueue()
  const op = ops.find(o => o.opId === opId)
  if (!op) return
  op.retries++
  if (op.retries >= MAX_RETRIES) {
    saveQueue(ops.filter(o => o.opId !== opId))
  } else {
    saveQueue(ops)
  }
}

// ── Mapa de IDs temporários: tempId → realId ───────────────────────────────────

function loadTempMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(TEMP_MAP_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch { return {} }
}

function saveTempMap(map: Record<string, string>): void {
  try { localStorage.setItem(TEMP_MAP_KEY, JSON.stringify(map)) } catch { /* noop */ }
}

export function registerTempId(tempId: string, realId: string): void {
  const map = loadTempMap()
  map[tempId] = realId
  saveTempMap(map)
  // Atualiza ops pendentes que ainda referenciam o ID temporário
  const ops = loadQueue()
  let changed = false
  for (const op of ops) {
    if (op.itemId === tempId) { op.itemId = realId; changed = true }
  }
  if (changed) saveQueue(ops)
}

export function resolveItemId(id: string): string {
  const map = loadTempMap()
  return map[id] ?? id
}

export function getTempIdMap(): Record<string, string> {
  return loadTempMap()
}
