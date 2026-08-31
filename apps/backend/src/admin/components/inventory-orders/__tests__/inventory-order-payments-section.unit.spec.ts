import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The headline over an inventory order's payouts (#1704).
 *
 * 🔴 `/admin/inventory-orders/:id/payments` returns `{billed, paid, recorded}`
 * and this panel rendered two of the three. So an order headlined
 * "INR 0 paid of INR 28,200 billed" directly above two COMPLETED payments
 * totalling ₹20,000 — and that reading is what nearly paid a partner twice.
 * Same shape as #1679: a value computed server-side, sent over the wire, with
 * no reader.
 *
 * There is no component test harness in this package, so this renders the
 * section to static markup with the data hooks stubbed. It exists to pin one
 * thing: both numbers reach the screen, and they stay distinguishable.
 */

jest.mock("react-router-dom", () => ({
  Link: ({ children }: any) => React.createElement("a", null, children),
}))

jest.mock("../../../hooks/api/payments", () => ({
  useUpdatePayment: () => ({ mutateAsync: jest.fn(), isPending: false }),
}))

const mockPayments = jest.fn()
jest.mock("../../../hooks/api/inventory-orders", () => ({
  useInventoryOrderPayments: (...args: any[]) => mockPayments(...args),
}))

/**
 * ⚠️ The jest swc transform emits CLASSIC JSX (`React.createElement`) while the
 * admin sources rely on the automatic runtime and import no React. Putting
 * React on the global keeps that transform working without changing the shared
 * jest config for every suite in the repo.
 */
;(globalThis as any).React = React

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { InventoryOrderPaymentsSection } = require("../inventory-order-payments-section")

const payout = {
  line_id: "psi_1",
  submission_id: "ps_1",
  submission_status: "Approved",
  submission_total: 28200,
  currency: "inr",
  amount: 28200,
  source_type: null,
}

const render = (totals: any, payments: any[] = []) => {
  mockPayments.mockReturnValue({
    payouts: [payout],
    payments,
    totals,
    isLoading: false,
    isError: false,
  })
  return renderToStaticMarkup(
    React.createElement(InventoryOrderPaymentsSection, {
      inventoryOrder: { id: "inv_order_1" },
    })
  )
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")

describe("InventoryOrderPaymentsSection — the headline", () => {
  it("🔴 shows what was RECORDED beside what has settled", () => {
    const html = text(render({ billed: 28200, paid: 0, recorded: 20000 }))

    expect(html).toContain("INR 28,200 billed")
    // The number that was missing. Without it the order reads as unpaid.
    expect(html).toContain("20,000")
    expect(html).toMatch(/recorded against this order/i)
  })

  it("does not blend the two — settled stays 0 while 20,000 is recorded", () => {
    // #1639 exists because collapsing them let a payout read `Paid` for 34
    // days before the money moved. Both facts, distinctly.
    const html = text(render({ billed: 28200, paid: 0, recorded: 20000 }))
    expect(html).toMatch(/INR 0 settled of INR 28,200 billed/)
  })

  it("says nothing about recorded money when there is none", () => {
    const html = text(render({ billed: 28200, paid: 0, recorded: 0 }))
    expect(html).not.toMatch(/recorded against this order/i)
    expect(html).toMatch(/INR 0 settled of INR 28,200 billed/)
  })
})
