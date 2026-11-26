import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { NOTE_MODULE } from "../../../../modules/notes"
import { findWorkNote, presentWorkNote } from "../../../../modules/notes/lib/work-notes"
import type { UpdateWorkNote } from "../validators"

/** GET /admin/work-notes/:ref — one note, by `N-12` or its id. */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const svc: any = req.scope.resolve(NOTE_MODULE)
  res.json({ work_note: presentWorkNote(await findWorkNote(svc, req.params.ref)) })
}

/**
 * POST /admin/work-notes/:ref — edit, close (`status: "done"`) or reopen.
 *
 * Closing stamps who and when; reopening clears both, so a reopened note never
 * still reads as done by someone.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as UpdateWorkNote
  const svc: any = req.scope.resolve(NOTE_MODULE)
  const note = await findWorkNote(svc, req.params.ref)

  const update: Record<string, unknown> = { id: note.id }
  if (body.body !== undefined) update.body = body.body
  if (body.kind !== undefined) update.kind = body.kind
  if (body.due_at !== undefined) update.due_at = body.due_at ? new Date(body.due_at) : null
  if (body.node_key !== undefined) update.node_key = body.node_key
  if (body.href !== undefined) update.href = body.href
  if (body.status && body.status !== note.status) {
    update.status = body.status
    update.done_at = body.status === "done" ? new Date() : null
    update.done_by = body.status === "done" ? req.auth_context?.actor_id ?? null : null
  }

  await svc.updateWorkNotes(update)
  res.json({ work_note: presentWorkNote(await findWorkNote(svc, note.id)) })
}
