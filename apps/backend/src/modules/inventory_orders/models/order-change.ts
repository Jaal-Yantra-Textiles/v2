import { model } from "@medusajs/framework/utils"
import Order from "./order"

/**
 * A PARTNER's proposed revision of an inventory order (#1752).
 *
 * ## Why this exists
 *
 * The partner surface can run an order to completion (`start` → `complete`) and
 * get paid for it, but it cannot say anything about the order itself. The two
 * things a partner most needs to say before they start work are:
 *
 *   1. the lines are wrong — a quantity to change, a price to correct, a line
 *      to drop; and
 *   2. tax is owed on top of the goods.
 *
 * Both are MONEY decisions. A line edit moves what the order is worth; a tax
 * charge raises the payable ceiling (`lib/order-charges.ts`). The whole of #1752
 * is the rule that a partner-created amount is a REQUEST, not a fact: it must
 * not reach the ledger — or the ceiling — until an operator has looked at it.
 *
 * So this row is the staging area between "the partner says" and "we owe". It
 * holds the proposed line set and the proposed charges as a DRAFT, and only an
 * admin approval (see the approve route) applies them to the real
 * `inventory_order_line` / `inventory_order_charge` tables, which remain the
 * single contract every guard reads.
 *
 * ## Why JSON here is fine
 *
 * The standing rule is "no money in metadata" (#1557) — but that rule is about
 * the LEDGER. `proposed_lines` / `proposed_charges` are a draft, never read by
 * `foldOrderCharges` or `assessInventoryOrderClaims`, and nothing is payable
 * until they are promoted into the typed tables. A draft is exactly the place a
 * JSON snapshot is correct: it is a snapshot, not a source of truth.
 */

/** The staged line ops, mirroring the admin order-lines update shape. */
export type ProposedLine = {
  /** Existing line id for an edit; absent for a new line (partners cannot add lines). */
  id: string
  inventory_item_id?: string
  quantity?: number
  price?: number
  extra_cost?: number | null
  remove?: boolean
}

/** The staged charges. Partners may only propose `tax`. */
export type ProposedCharge = {
  type: "tax"
  amount: number
  note?: string | null
}

const InventoryOrderChange = model.define("inventory_order_change", {
  id: model.id({ prefix: "invrev" }).primaryKey(),
  /**
   * pending → approved / rejected. Only a `pending` row is editable by the
   * partner and applicable by the admin; the terminal states are a record.
   */
  status: model.enum(["pending", "approved", "rejected"]).default("pending"),
  /** The partner's DESIRED final line set (edits carry `id`, removals `remove`). */
  proposed_lines: model.json().nullable(),
  /** The partner's proposed `tax` charges, to be created as real charges on approval. */
  proposed_charges: model.json().nullable(),
  /** Partner id that staged this revision (the actor, for the audit trail). */
  submitted_by: model.text().nullable(),
  submitted_at: model.dateTime().nullable(),
  /** Admin id that approved/rejected it. */
  decided_by: model.text().nullable(),
  decided_at: model.dateTime().nullable(),
  rejection_reason: model.text().nullable(),
  metadata: model.json().nullable(),

  inventory_orders: model.belongsTo(() => Order, {
    mappedBy: "changes",
  }),
})

export default InventoryOrderChange