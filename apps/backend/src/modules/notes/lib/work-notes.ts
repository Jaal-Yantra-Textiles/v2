import { MedusaError } from "@medusajs/framework/utils"

/**
 * Work notes (#2625 S2) — the pure rules, shared by the admin routes, the
 * Pending work board and the MCP tools so the three never disagree on what
 * "N-12" or "overdue" means.
 */

export type WorkNoteRow = {
  id: string
  ref: number
  body: string
  kind: "note" | "follow_up"
  status: "open" | "done"
  due_at: string | Date | null
  board: string
  node_key: string | null
  entity_name: string | null
  entity_id: string | null
  href: string | null
  created_at?: string | Date | null
  done_at?: string | Date | null
}

export const formatRef = (ref: number) => `N-${ref}`

/**
 * "N-12", "n12", "#12", "12" → 12. A note id (`wnote_…`) → null, so the caller
 * looks it up by id instead. Anything else is a 400, never a guess.
 */
export const parseRef = (input: string): number | null => {
  const s = String(input ?? "").trim()
  if (/^wnote_/i.test(s)) return null
  const m = /^(?:n-?|#)?(\d+)$/i.exec(s)
  if (!m) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `"${s}" is not a note reference. Use N-12 or the note id.`
    )
  }
  return Number(m[1])
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from now to the due date: negative = overdue. Null with no due date. */
export const daysUntilDue = (due: unknown, now = Date.now()): number | null => {
  if (!due) return null
  const t = new Date(due as any).getTime()
  if (!Number.isFinite(t)) return null
  // Compare calendar days, so "due today" stays today all day.
  const startOf = (ms: number) => {
    const d = new Date(ms)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  }
  return Math.round((startOf(t) - startOf(now)) / DAY_MS)
}

export const dueLabel = (due: unknown, now = Date.now()): string | null => {
  const d = daysUntilDue(due, now)
  if (d === null) return null
  if (d === 0) return "due today"
  if (d > 0) return `due in ${d} day${d === 1 ? "" : "s"}`
  return `overdue ${-d} day${d === -1 ? "" : "s"}`
}

export const isOverdue = (n: Pick<WorkNoteRow, "status" | "due_at">, now = Date.now()) =>
  n.status === "open" && (daysUntilDue(n.due_at, now) ?? 0) < 0

/**
 * Open notes in working order: overdue first, then by due date, then undated
 * oldest first. A note with no due date never jumps ahead of a dated one.
 */
export const sortOpenNotes = <T extends WorkNoteRow>(notes: T[]): T[] =>
  [...notes].sort((a, b) => {
    const da = a.due_at ? new Date(a.due_at as any).getTime() : Infinity
    const db = b.due_at ? new Date(b.due_at as any).getTime() : Infinity
    if (da !== db) return da - db
    return a.ref - b.ref
  })

/** Open notes per board box, for the "· 2 notes" suffix on that box. */
export const countByBox = (notes: WorkNoteRow[]): Map<string, number> => {
  const m = new Map<string, number>()
  for (const n of notes) {
    if (n.status !== "open" || !n.node_key) continue
    m.set(n.node_key, (m.get(n.node_key) ?? 0) + 1)
  }
  return m
}

/** Resolve "N-12" or a note id to one row, or 404. */
export const findWorkNote = async (svc: any, refOrId: string): Promise<WorkNoteRow> => {
  const ref = parseRef(refOrId)
  const rows = await svc.listWorkNotes(ref === null ? { id: refOrId } : { ref }, { take: 1 })
  const row = rows?.[0]
  if (!row) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `No note ${ref === null ? refOrId : formatRef(ref)}`)
  }
  return row
}

/** The API shape: the row plus its quotable reference. */
export const presentWorkNote = (n: WorkNoteRow, now = Date.now()) => ({
  ...n,
  reference: formatRef(n.ref),
  due: dueLabel(n.due_at, now),
  overdue: isOverdue(n, now),
})
