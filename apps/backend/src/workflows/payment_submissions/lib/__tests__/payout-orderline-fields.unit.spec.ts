import { readFileSync } from "fs"
import { join } from "path"

/**
 * The offer and the bill must fetch the SAME order-line fields.
 *
 * `list_payable_inventory_orders` (the offer a partner is shown) and
 * `create-payment-submission` (the bill actually written) both value an order
 * through `valueInventoryOrderByReceipts`. That function can only price what
 * the caller's `query.graph` field list fetched — it cannot add a column the
 * query dropped.
 *
 * That is how `extra_cost` came to be missing from a payout: the function, the
 * type AND both field lists all omitted it, so no single-file fix would have
 * changed the money. The unit specs beside this one mock `orderlines` directly
 * and hand the valuer a well-formed line, so they cannot see a field list go
 * wrong — only a source-level pin can.
 *
 * This is deliberately a SOURCE assertion rather than a behavioural one: the
 * field lists are inline literals inside `query.graph` calls, and exporting
 * them purely to test them would be a worse trade than reading the two files.
 */

const ROOT = join(__dirname, "..", "..")

const orderlineFields = (relativePath: string): Set<string> => {
  const source = readFileSync(join(ROOT, relativePath), "utf8")
  const fields = new Set<string>()
  // Matches "inventory_orders.orderlines.price" and "orderlines.price" alike,
  // keeping only the part after `orderlines.` so the two call sites compare.
  for (const match of source.matchAll(/["']([\w.]*\borderlines\.)([\w.]+)["']/g)) {
    fields.add(match[2])
  }
  return fields
}

const PAYABLE = "lib/payable-inventory-orders.ts"
const SUBMISSION = "create-payment-submission.ts"

describe("payout order-line field lists", () => {
  it("finds a non-trivial field list in both call sites", () => {
    // Guards the regex itself: if a refactor moves these off string literals,
    // every assertion below would pass vacuously on two empty sets.
    expect(orderlineFields(PAYABLE).size).toBeGreaterThan(3)
    expect(orderlineFields(SUBMISSION).size).toBeGreaterThan(3)
  })

  it.each([
    ["the payable list (the offer)", PAYABLE],
    ["the payment submission (the bill)", SUBMISSION],
  ])("%s fetches the money fields the valuer prices from", (_label, path) => {
    const fields = orderlineFields(path)

    // Both halves of the agreed unit value. Dropping extra_cost underpays every
    // order carrying a colour/dye/finishing charge.
    expect(fields).toContain("price")
    expect(fields).toContain("extra_cost")
    // Receipts drive what is owed at all.
    expect(fields).toContain("line_fulfillments.quantity_delta")
  })

  it("fetches identical order-line fields on both sides", () => {
    const payable = [...orderlineFields(PAYABLE)].sort()
    const submission = [...orderlineFields(SUBMISSION)].sort()

    // Drift here does not fail loudly — it makes the number a partner is
    // OFFERED differ from the number they are BILLED, on the same order.
    expect(submission).toEqual(payable)
  })
})
