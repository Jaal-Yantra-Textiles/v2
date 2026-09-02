import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The partner ledger's double-pay warning (#1710).
 *
 * 🔴 The route now computes `recorded_against_open` and attaches
 * `recorded_against` to each payout. A value computed server-side with no
 * reader on the screen is worth nothing — that is #1679's shape, and #1704's,
 * and it is why an order headlined "INR 0 paid" over INR 20,000 of completed
 * payments. So this pins the one thing: the warning REACHES THE SCREEN.
 *
 * There is no component test harness in this package; this renders the section
 * to static markup with its data hooks stubbed, the same shape
 * `inventory-order-payments-section.unit.spec.ts` established in #1706.
 */

jest.mock("react-router-dom", () => ({
  Link: ({ children }: any) => React.createElement("a", null, children),
}))

const mockLedger = jest.fn()
jest.mock("../../../hooks/api/payments", () => ({
  usePartnerLedger: (...args: any[]) => mockLedger(...args),
  useUpdatePayment: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useSetPaymentSettles: () => ({ mutateAsync: jest.fn(), isPending: false }),
}))

/**
 * ⚠️ The jest swc transform emits CLASSIC JSX while the admin sources rely on
 * the automatic runtime and import no React.
 */
;(globalThis as any).React = React

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PartnerLedgerSection } = require("../partner-ledger-section")

/** The prod shape from #1710: Parmar, INR 28,200 Approved, INR 20,000 moved. */
const payout = (over: Record<string, any> = {}) => ({
  id: "payout:01M13T9D9A",
  kind: "payout" as const,
  status: "Approved",
  amount: 28200,
  currency: "inr",
  occurred_at: "2026-08-28T10:00:00.000Z",
  submission_id: "01M13T9D9A",
  lines: [],
  submitted_at: "2026-08-28T10:00:00.000Z",
  settled_by: null,
  recorded_against: [
    {
      payment_id: "pay_jul",
      amount: 10000,
      status: "Completed",
      payment_type: "Bank",
      payment_date: "2026-07-11T00:00:00.000Z",
      via: "inventory_order",
      inventory_order_id: "inv_order_01KWAKAZE1",
      inventory_order_name: "Parmar cotton",
    },
    {
      payment_id: "pay_aug",
      amount: 10000,
      status: "Completed",
      payment_type: "Bank",
      payment_date: "2026-08-30T00:00:00.000Z",
      via: "inventory_order",
      inventory_order_id: "inv_order_01KWAKAZE1",
      inventory_order_name: "Parmar cotton",
    },
  ],
  recorded_against_total: 20000,
  ...over,
})

const totals = (over: Record<string, any> = {}) => ({
  billed: 28200,
  paid: 0,
  outstanding: 28200,
  recorded: 20000,
  recorded_against_open: 20000,
  currency: "inr",
  ...over,
})

const render = (entries: any[], t: any) => {
  mockLedger.mockReturnValue({
    entries,
    totals: t,
    isLoading: false,
    isError: false,
  })
  return renderToStaticMarkup(
    React.createElement(PartnerLedgerSection, { partnerId: "partner_1" })
  )
}

const text = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ")

describe("PartnerLedgerSection — the double-pay warning (#1710)", () => {
  it("🔴 warns on the totals line that money sits against an unpaid payout", () => {
    const html = text(render([payout()], totals()))

    // The reading that pays someone twice, still present and still honest…
    expect(html).toMatch(/outstanding/i)
    // …and the number that stops it.
    expect(html).toContain("20,000")
    expect(html).toMatch(/an unpaid payout still bills/i)
  })

  it("warns on the payout ROW, naming the order the money sits against", () => {
    const html = text(render([payout()], totals()))

    expect(html).toMatch(/already\s+recorded against/i)
    expect(html).toMatch(/check before paying/i)
  })

  it("stays silent when nothing is recorded against an open payout", () => {
    const html = text(
      render(
        [payout({ recorded_against: [], recorded_against_total: 0 })],
        totals({ recorded: 0, recorded_against_open: 0 })
      )
    )

    expect(html).not.toMatch(/check before paying/i)
    expect(html).not.toMatch(/an unpaid payout still bills/i)
  })

  it("stops warning on the row once the payout is Paid", () => {
    // Money against a settled payout is history, not a double-pay risk.
    const html = text(
      render(
        [payout({ status: "Paid", paid_at: "2026-08-31T00:00:00.000Z" })],
        totals({ paid: 28200, outstanding: 0, recorded_against_open: 0 })
      )
    )

    expect(html).not.toMatch(/check before paying/i)
  })

  it("says which ORDER a recorded payment belongs to, not just that it exists", () => {
    /**
     * 🔴 Before #1710 this row could not appear at all: the ledger read
     * payments through the partner link only, and this one is attached to the
     * inventory order.
     */
    const html = text(
      render(
        [
          {
            id: "payment:pay_jul",
            kind: "payment" as const,
            status: "Completed",
            amount: 10000,
            currency: "inr",
            occurred_at: "2026-07-11T00:00:00.000Z",
            payment_type: "Bank",
            payment_date: "2026-07-11T00:00:00.000Z",
            attachments: [],
            inventory_order_id: "inv_order_01KWAKAZE1",
            inventory_order_name: "Parmar cotton",
          },
        ],
        totals({ billed: 0, outstanding: 0, recorded_against_open: 0 })
      )
    )

    expect(html).toMatch(/recorded against Parmar cotton/i)
    expect(html).toMatch(/no payout attached/i)
  })
})

describe("PartnerLedgerSection — acting on the warning (#1710)", () => {
  it("🔑 offers a way to SETTLE each payment the warning names", () => {
    /**
     * A warning with no action beside it becomes wallpaper. The route
     * (`POST /admin/payments/:id/settles`) is the human statement the ledger
     * refuses to infer — and a capability with no screen is no capability
     * (#1612).
     */
    const html = text(render([payout()], totals()))

    expect(html).toMatch(/Mark .* as settling this payout/i)
    // One per payment named in the warning, not one for the row.
    expect(html.match(/as settling this payout/gi)).toHaveLength(2)
  })

  it("offers nothing to settle when nothing is recorded against the payout", () => {
    const html = text(
      render(
        [payout({ recorded_against: [], recorded_against_total: 0 })],
        totals({ recorded: 0, recorded_against_open: 0 })
      )
    )

    expect(html).not.toMatch(/as settling this payout/i)
  })
})

/**
 * Applied credits on the ledger (#1712).
 *
 * 🔴 An applied credit has ALREADY reduced `outstanding`. If it does not reach
 * the screen the footer shows a smaller amount owed than the payouts above add
 * up to, with nothing explaining the difference — a reader either distrusts the
 * panel or, worse, trusts the larger figure and pays it.
 */
describe("PartnerLedgerSection — applied credits (#1712)", () => {
  it("names the credit that discharged part of a payout", () => {
    const html = render(
      [
        payout({
          recorded_against: [],
          recorded_against_total: 0,
          credited_amount: 1380,
          credits_applied: [
            {
              credit_id: "cred_1",
              amount: 1380,
              reason: "Paid 30,000 against a 28,620 payout",
              applied_at: "2026-09-02T00:00:00.000Z",
            },
          ],
        }),
      ],
      totals({ credited: 1380, outstanding: 26820 })
    )

    expect(html).toContain("discharged by")
    expect(html).toContain("Paid 30,000 against a 28,620 payout")
  })

  it("puts credited in the footer, beside paid and outstanding", () => {
    const html = render(
      [payout({ recorded_against: [], recorded_against_total: 0 })],
      totals({ credited: 1380, outstanding: 26820 })
    )
    expect(html).toContain("credited")
  })

  /** Silent when there is nothing to say — a "₹0 credited" is noise. */
  it("says nothing about credits when none were applied", () => {
    const html = render(
      [payout({ recorded_against: [], recorded_against_total: 0 })],
      totals({ credited: 0 })
    )
    expect(html).not.toContain("credited")
    expect(html).not.toContain("discharged by")
  })
})

/** One payment across two payouts (#1712 defect 2) — the row explains itself. */
describe("PartnerLedgerSection — a shared payment (#1712)", () => {
  it("says a payout shares its payment, so a small settled figure is not a bug", () => {
    const html = render(
      [
        payout({
          recorded_against: [],
          recorded_against_total: 0,
          settled_amount: 0,
          settled_shared_with: ["01M13T9OTHER"],
        }),
      ],
      totals({ paid: 0 })
    )
    expect(html).toContain("shares a payment with")
    expect(html).toContain("counted once")
  })

  it("says nothing when the payment is this payout's alone", () => {
    const html = render(
      [payout({ recorded_against: [], recorded_against_total: 0 })],
      totals()
    )
    expect(html).not.toContain("shares a payment with")
  })
})
