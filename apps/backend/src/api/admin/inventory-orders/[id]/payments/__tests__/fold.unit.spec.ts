import { foldOrderPayouts } from "../fold"

/**
 * The order-side view of a payout (#1622). Every case here is a shape that
 * actually exists on prod as of 2026-08-28 — a Pending payout, a payout
 * covering two orders, and a line whose submission cannot be found.
 */
describe("foldOrderPayouts", () => {
  const submission = (over: Record<string, any> = {}) => ({
    id: "sub_1",
    status: "Pending",
    total_amount: 28670,
    partner_id: "partner_1",
    currency: "inr",
    created_at: "2026-08-28T08:00:00.000Z",
    ...over,
  })

  it("shows a PENDING payout — the link-based panel could not", () => {
    const { payouts, billed, paid } = foldOrderPayouts(
      [{ id: "line_1", submission_id: "sub_1", amount: 25670 }],
      [submission()]
    )

    expect(payouts).toHaveLength(1)
    expect(payouts[0].submission_status).toBe("Pending")
    expect(billed).toBe(25670)
    // Billed is not paid. An order with a pending payout owes the money.
    expect(paid).toBe(0)
  })

  it("bills this order its own LINE, not the submission total", () => {
    // hrhandloom's real payout: two inventory orders on one submission,
    // 25,670 + 3,000 = 28,670. The order showing 28,670 would be a lie.
    const { payouts, billed } = foldOrderPayouts(
      [{ id: "line_1", submission_id: "sub_1", amount: 25670 }],
      [submission()]
    )

    expect(payouts[0].amount).toBe(25670)
    expect(payouts[0].submission_total).toBe(28670)
    expect(billed).toBe(25670)
  })

  it("counts a Paid submission as paid, and an Approved one as not", () => {
    const rows = [
      { id: "line_paid", submission_id: "sub_paid", amount: 30000 },
      { id: "line_appr", submission_id: "sub_appr", amount: 1000 },
    ]
    const subs = [
      submission({ id: "sub_paid", status: "Paid", total_amount: 30000 }),
      submission({ id: "sub_appr", status: "Approved", total_amount: 1000 }),
    ]

    const { billed, paid } = foldOrderPayouts(rows, subs)

    expect(billed).toBe(31000)
    // Approved has a payment record but the transfer is still owed —
    // markSubmissionPaidStep is what makes it Paid.
    expect(paid).toBe(30000)
  })

  it("keeps a line whose submission is missing, with a null status", () => {
    // Absence must not delete the line: an order that was billed still shows
    // the amount, flagged as unknown rather than silently dropped.
    const { payouts, billed, paid } = foldOrderPayouts(
      [{ id: "line_1", submission_id: "sub_gone", amount: 500 }],
      []
    )

    expect(payouts).toHaveLength(1)
    expect(payouts[0].submission_status).toBeNull()
    expect(billed).toBe(500)
    expect(paid).toBe(0)
  })

  it("carries the fields describePaymentLine reads", () => {
    const { payouts } = foldOrderPayouts(
      [
        {
          id: "line_1",
          submission_id: "sub_1",
          amount: 3000,
          source_type: "inventory_order",
          inventory_order_id: "inv_order_1",
          inventory_order_name: "Inventory order inv_order_1",
        },
      ],
      [submission()]
    )

    expect(payouts[0].source_type).toBe("inventory_order")
    expect(payouts[0].inventory_order_name).toBe("Inventory order inv_order_1")
  })

  it("coerces bigNumber-ish string amounts rather than concatenating them", () => {
    const { billed } = foldOrderPayouts(
      [
        { id: "a", submission_id: "sub_1", amount: "25670" },
        { id: "b", submission_id: "sub_1", amount: "3000" },
      ],
      [submission()]
    )

    expect(billed).toBe(28670)
  })

  it("orders newest payout first", () => {
    const { payouts } = foldOrderPayouts(
      [
        { id: "old", submission_id: "sub_old", amount: 1 },
        { id: "new", submission_id: "sub_new", amount: 2 },
      ],
      [
        submission({ id: "sub_old", created_at: "2026-01-01T00:00:00.000Z" }),
        submission({ id: "sub_new", created_at: "2026-08-28T00:00:00.000Z" }),
      ]
    )

    expect(payouts.map((p) => p.line_id)).toEqual(["new", "old"])
  })
})
