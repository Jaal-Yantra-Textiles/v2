import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The partner credits panel (#1712).
 *
 * 🔴 What this pins is that the facts REACH THE SCREEN. A credit was
 * recordable and readable and nothing more — `status` starts `Open`, is
 * displayed beside `outstanding` and never netted against it, and there was no
 * screen on which a human could make the decision to apply it. A capability
 * with no screen is no capability (#1612). And the earmark, a second link the
 * create route writes, was exposed by no read at all.
 *
 * Same harness as `partner-ledger-section.unit.spec.ts`: render to static
 * markup with the data hooks stubbed. There is no component test harness here.
 */

jest.mock("react-router-dom", () => ({
  Link: ({ children }: any) => React.createElement("a", null, children),
}))

const mockCredits = jest.fn()
const mockLedger = jest.fn()
jest.mock("../../../hooks/api/payments", () => ({
  usePartnerCredits: (...args: any[]) => mockCredits(...args),
  usePartnerLedger: (...args: any[]) => mockLedger(...args),
  useApplyPartnerCredit: () => ({ mutateAsync: jest.fn(), isPending: false }),
}))

/**
 * ⚠️ The jest swc transform emits CLASSIC JSX while the admin sources rely on
 * the automatic runtime and import no React.
 */
;(globalThis as any).React = React

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PartnerCreditsSection } = require("../partner-credits-section")

/** hrhandloom's real credit: 1,380 from being paid 30,000 on a 28,620 payout. */
const credit = (over: Record<string, any> = {}) => ({
  id: "01M1EA29VR9H1466JJ0F4FWEPN",
  amount: 1380,
  currency_code: "inr",
  status: "Open",
  source_type: "overpayment",
  reason: "Paid 30,000 against a 28,620 payout",
  source_submission_id: null,
  applied_to_submission_id: null,
  applied_at: null,
  inventory_order_id: null,
  ...over,
})

const payout = (over: Record<string, any> = {}) => ({
  id: "payout:01M13T9D9A",
  kind: "payout" as const,
  status: "Approved",
  amount: 10000,
  currency: "inr",
  occurred_at: "2026-09-01T00:00:00.000Z",
  submission_id: "01M13T9D9A",
  settled_amount: 0,
  credited_amount: 0,
  ...over,
})

const render = (
  credits: any[],
  entries: any[] = [payout()],
  over: Record<string, any> = {}
) => {
  mockCredits.mockReturnValue({
    credits,
    count: credits.length,
    open_total: credits
      .filter((c) => c.status === "Open")
      .reduce((a, c) => a + c.amount, 0),
    currency: "inr",
    isLoading: false,
    isError: false,
    ...over,
  })
  mockLedger.mockReturnValue({ entries, isLoading: false, isError: false })
  return renderToStaticMarkup(
    React.createElement(PartnerCreditsSection, { partnerId: "partner_1" })
  )
}

describe("PartnerCreditsSection (#1712)", () => {
  it("shows what the partner holds", () => {
    const html = render([credit()])
    expect(html).toContain("1,380")
    expect(html).toContain("held")
    expect(html).toContain("Open")
  })

  /**
   * 🔑 A bare amount with no statement of origin is the shape that let
   * `metadata` blobs decide payouts (#1557).
   */
  it("always states why the credit exists", () => {
    expect(render([credit()])).toContain(
      "Paid 30,000 against a 28,620 payout"
    )
  })

  /**
   * 🔴 The gap this closes. The earmark is a link the create route writes and
   * no read exposed — a fact the database held and no surface showed.
   */
  it("renders the earmarked order", () => {
    const html = render([credit({ inventory_order_id: "01K36TE2WB" })])
    expect(html).toContain("earmarked against order")
    expect(html).toContain("01K36TE2WB")
  })

  it("says nothing about an earmark when there is none", () => {
    expect(render([credit()])).not.toContain("earmarked against order")
  })

  it("shows the payout an applied credit discharged, and when", () => {
    const html = render([
      credit({
        status: "Applied",
        applied_to_submission_id: "01M13T9D9A",
        applied_at: "2026-09-02T00:00:00.000Z",
      }),
    ])
    expect(html).toContain("applied to")
    expect(html).toContain("01M13T9D9A")
    expect(html).toContain("Applied")
  })

  /** An Applied credit has been consumed — no picker, nothing left to decide. */
  it("offers no apply control on a credit that is not Open", () => {
    const html = render([credit({ status: "Applied" })])
    expect(html).not.toContain("Apply to a payout")
  })

  it("offers the open payouts a credit can be applied to", () => {
    const html = render([credit()])
    expect(html).toContain("still claimed")
  })

  /**
   * ⚠️ Offered and DISABLED with the reason, never hidden. A credit applies
   * whole, and hiding the payout leaves an operator wondering where it went.
   */
  it("offers a payout too small for the credit, saying why it cannot take it", () => {
    const html = render([credit({ amount: 50000 })], [payout()])
    expect(html).toContain("credit is larger than this")
  })

  it("marks a payout with nothing left to claim", () => {
    const html = render([credit()], [payout({ settled_amount: 10000 })])
    expect(html).toContain("nothing left to claim")
  })

  /** Paid and Rejected payouts are not candidates at all. */
  it("does not offer a Paid or Rejected payout", () => {
    const html = render(
      [credit()],
      [payout({ status: "Paid" }), payout({ id: "p2", status: "Rejected" })]
    )
    expect(html).toContain("No payout is open to apply this against")
  })

  /**
   * 🔴 An error must never render as "they hold nothing". That reading is
   * exactly the one that lets a credit be paid out a second time.
   */
  it("does not report an unreadable list as an empty one", () => {
    const html = render([], [], { isError: true })
    expect(html).toContain("could not be read")
    expect(html).not.toContain("holds no credit")
  })

  it("says plainly when a partner genuinely holds nothing", () => {
    expect(render([])).toContain("holds no credit")
  })
})
