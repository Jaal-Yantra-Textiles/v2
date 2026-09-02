import { model } from "@medusajs/framework/utils";
import Order from "./order";

/**
 * An amount on an inventory order that is NOT goods (#1737).
 *
 * ## Why this exists
 *
 * Three of these turned up in a single reconciliation and none had a home:
 * 200 of tax on a Terry Towel order, 1,960 of shipping on
 * `inv_order_01K5QSCSK…`, and an 829 write-off on the same order. The model
 * carried `total_price` and nothing else, so an order whose real cost included
 * freight understated it, and a settled remainder could not be recorded at all.
 * The only writable home was `metadata` — the trap #1557 closed, where an
 * untyped blob decided payouts.
 *
 * ## Why on the ORDER and not the payout
 *
 * Tax is a property of the obligation, not of the settlement. Three consequences
 * if it lived on the payout instead:
 *
 *  1. `assessInventoryOrderClaims` refuses any claim past the order's ceiling,
 *     so a payout correctly including tax would be refused by the guard.
 *  2. One order is often paid by several payouts, so the charge would have to
 *     be apportioned across them — the arithmetic that already underpaid a run
 *     by 22% (#1596). Nobody agreed to a fraction of a tax.
 *  3. `payable-inventory-orders` derives value from order LINES; a charge off
 *     the order can never be reached by receipts.
 *
 * ## 🔴 `total_price` still means GOODS
 *
 * Charges are deliberately NOT folded into it. That column means "what was
 * ordered" to every reader and every guard, and changing its meaning in place
 * is the one-column-two-meanings trap that already cost us `quantity` being a
 * rate or a total (#1559). The payable ceiling is derived from both, in one
 * place — `lib/order-charges.ts` — so nothing re-derives it differently.
 */
const OrderCharge = model.define("inventory_order_charge", {
  id: model.id({ prefix: "invchg" }).primaryKey(),
  /**
   * 🔑 What KIND of amount this is, because the sign is not a property of the
   * number — it is a property of the type. A `tax` of 200 and a `discount` of
   * 200 are the same figure and opposite facts, and storing a signed amount
   * would let a typo flip an obligation into a reduction with nothing to catch
   * it.
   */
  type: model.enum(["tax", "shipping", "discount", "adjustment"]),
  /** Always POSITIVE. The type decides which way it moves the ceiling. */
  amount: model.bigNumber(),
  /**
   * ⚠️ Why this amount exists, in the operator's words.
   *
   * Required in practice for the lowering types — a reduction nobody explained
   * is exactly how an 829 write-off gets lost and then rediscovered as an
   * overpayment. Enforced at the route rather than the column so historical
   * rows can be backfilled without a reason nobody remembers.
   */
  note: model.text().nullable(),
  metadata: model.json().nullable(),

  inventory_orders: model.belongsTo(() => Order, {
    mappedBy: "charges",
  }),
});

export default OrderCharge;
