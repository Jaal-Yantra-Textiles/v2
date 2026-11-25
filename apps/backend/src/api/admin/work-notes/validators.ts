import { z } from "@medusajs/framework/zod"

/**
 * #2625 S2 — notes on the Pending work board.
 *
 * `due_at` takes a date ("2026-11-30") or a full timestamp. A follow-up is
 * just a note with `kind: "follow_up"`; a due date alone does not make one.
 */
const dueAt = z
  .union([z.string().min(1), z.null()])
  .optional()
  .refine((v) => v == null || Number.isFinite(new Date(v).getTime()), {
    message: "due_at must be a date like 2026-11-30",
  })

export const CreateWorkNoteSchema = z.object({
  body: z.string().trim().min(1, "A note needs some text"),
  kind: z.enum(["note", "follow_up"]).optional(),
  due_at: dueAt,
  board: z.string().optional(),
  node_key: z.string().nullable().optional(),
  entity_name: z.string().nullable().optional(),
  entity_id: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
})
export type CreateWorkNote = z.infer<typeof CreateWorkNoteSchema>

export const UpdateWorkNoteSchema = z.object({
  body: z.string().trim().min(1).optional(),
  kind: z.enum(["note", "follow_up"]).optional(),
  due_at: dueAt,
  status: z.enum(["open", "done"]).optional(),
  node_key: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
})
export type UpdateWorkNote = z.infer<typeof UpdateWorkNoteSchema>

export const ListWorkNotesQuerySchema = z.object({
  status: z.enum(["open", "done", "all"]).optional().default("open"),
  board: z.string().optional(),
  node_key: z.string().optional(),
  entity_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
})
export type ListWorkNotesQuery = z.infer<typeof ListWorkNotesQuerySchema>
