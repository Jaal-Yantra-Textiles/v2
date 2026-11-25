import { model } from "@medusajs/framework/utils"

/**
 * A note on the Pending work board (#2625 S2).
 *
 * Kept apart from `note` (the free-form note attached to any record) because
 * this one has a LIFECYCLE: it is open until someone marks it done, it can be
 * a follow-up with a due date, and it carries a short reference (`N-12`) the
 * founder can quote in chat or to a Claude session.
 *
 * `ref` is an autoincrement so a reference is never reused: a done note keeps
 * its number, and "N-12" means the same note forever.
 *
 * `node_key` is the board box it sits on ("balances-due"), `entity_*` the
 * record it is about. Both optional: a note can be about nothing yet.
 */
const WorkNote = model
  .define("work_note", {
    id: model.id({ prefix: "wnote" }).primaryKey(),
    ref: model.autoincrement(),
    body: model.text(),
    kind: model.enum(["note", "follow_up"]).default("note"),
    status: model.enum(["open", "done"]).default("open"),
    due_at: model.dateTime().nullable(),
    board: model.text().default("pending-work"),
    node_key: model.text().nullable(),
    entity_name: model.text().nullable(),
    entity_id: model.text().nullable(),
    /** Admin path to the record, e.g. `/orders/order_01…`. */
    href: model.text().nullable(),
    created_by: model.text().nullable(),
    done_at: model.dateTime().nullable(),
    done_by: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([{ on: ["status"] }, { on: ["ref"], unique: true }])

export default WorkNote
