import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { NOTE_MODULE } from "../../../modules/notes"
import { presentWorkNote, sortOpenNotes } from "../../../modules/notes/lib/work-notes"
import type { CreateWorkNote, ListWorkNotesQuery } from "./validators"

/**
 * GET /admin/work-notes — notes on the Pending work board (#2625 S2).
 *
 * Open notes by default, in working order (overdue first). `status=done` or
 * `all` for the history; done notes keep their reference.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const q = req.validatedQuery as unknown as ListWorkNotesQuery
  const svc: any = req.scope.resolve(NOTE_MODULE)
  const filters: Record<string, unknown> = {}
  if (q.status !== "all") filters.status = q.status
  if (q.board) filters.board = q.board
  if (q.node_key) filters.node_key = q.node_key
  if (q.entity_id) filters.entity_id = q.entity_id
  const [rows, count] = await svc.listAndCountWorkNotes(filters, {
    take: q.limit,
    order: { ref: q.status === "open" ? "ASC" : "DESC" },
  })
  const list = q.status === "open" ? sortOpenNotes(rows) : rows
  res.json({ work_notes: list.map((n: any) => presentWorkNote(n)), count })
}

/** POST /admin/work-notes — add a note; the response carries its `N-12` reference. */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as CreateWorkNote
  const svc: any = req.scope.resolve(NOTE_MODULE)
  const created = await svc.createWorkNotes({
    body: body.body,
    kind: body.kind ?? "note",
    due_at: body.due_at ? new Date(body.due_at) : null,
    board: body.board ?? "pending-work",
    node_key: body.node_key ?? null,
    entity_name: body.entity_name ?? null,
    entity_id: body.entity_id ?? null,
    href: body.href ?? null,
    created_by: req.auth_context?.actor_id ?? null,
  })
  // Read back: `ref` is assigned by the database, not by the create call.
  const [row] = await svc.listWorkNotes({ id: created.id }, { take: 1 })
  res.status(201).json({ work_note: presentWorkNote(row ?? created) })
}
