import { foldPartnerLedger } from "../fold"

/**
 * The merged partner ledger (#1612). Every case here is a shape that exists on
 * prod as of 2026-08-29 — a modern payout with no payment row behind it, the 26
 * historical payments no payout accounts for, and the 5 that a reconciliation
 * ties back to a submission.
 */
describe("foldPartnerLedger", () => {
  const submission = (over: Record<string, any> = {}) => ({
    id: "sub_1",
    status: "Pending",
    total_amount: 28670,
    currency: "inr",
    submitted_at: "2026-08-28T08:00:00.000Z",
    ...over,
  })

  const payment = (over: Record<string, any> = {}) => ({
    id: "pay_1",
    amount: 1250,
    status: "Completed",
    payment_type: "Bank",
    payment_date: "2026-06-14T22:00:00.000Z",
    ...over,
  })

  const fold = (over: Record<string, any> = {}) =>
    foldPartnerLedger({
      submissions: [],
      items: [],
      payments: [],
      reconciliations: [],
      ...over,
    })

  it("renders a payout that has NO internal_payments row — the old panel showed nothing", () => {
    // Since #1638 approval writes no payment row at all. A panel reading
    // `internal_payments` alone is silently empty for every payout since.
    const { entries, totals } = fold({ submissions: [submission()] })

    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("payout")
    expect(entries[0].amount).toBe(28670)
    expect(totals.billed).toBe(28670)
    expect(totals.outstanding).toBe(28670)
  })

  it("renders a historical payment no payout accounts for, and keeps it OUT of paid", () => {
    const { entries, totals } = fold({ payments: [payment()] })

    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("payment")
    expect(totals.recorded).toBe(1250)
    // It is history, not a settled payout. Adding it to `paid` would describe
    // money that no submission ever claimed as if a payout existed for it.
    expect(totals.paid).toBe(0)
    expect(totals.billed).toBe(0)
  })

  it("attaches a submission-derived payment to its payout instead of listing it twice", () => {
    const { entries, totals } = fold({
      submissions: [submission({ status: "Paid", paid_at: "2026-08-28T08:49:00.000Z" })],
      payments: [payment({ id: "pay_9", amount: 28670 })],
      reconciliations: [
        {
          reference_type: "payment_submission",
          reference_id: "sub_1",
          payment_id: "pay_9",
          settled_at: "2026-08-28T08:49:00.000Z",
        },
      ],
    })

    // ONE entry for one payout, not two rows for the same 28,670.
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("payout")
    expect(entries[0].settled_by?.payment_id).toBe("pay_9")
    expect(totals.paid).toBe(28670)
    expect(totals.recorded).toBe(0)
  })

  it("does not swallow a payment whose reconciliation names ANOTHER partner's submission", () => {
    // The reconciliation read is not scoped per partner, so a stray row must
    // not silently remove a payment this partner really has.
    const { entries, totals } = fold({
      payments: [payment({ id: "pay_9" })],
      reconciliations: [
        {
          reference_type: "payment_submission",
          reference_id: "sub_of_someone_else",
          payment_id: "pay_9",
        },
      ],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("payment")
    expect(totals.recorded).toBe(1250)
  })

  it("counts a Paid payout as paid and an Approved one as still owed", () => {
    // ⚠️ Approval → settlement ran to 34 days on prod. Approved is not paid.
    const { totals } = fold({
      submissions: [
        submission({ id: "sub_paid", status: "Paid", total_amount: 100 }),
        submission({ id: "sub_appr", status: "Approved", total_amount: 250 }),
      ],
    })

    expect(totals.billed).toBe(350)
    expect(totals.paid).toBe(100)
    expect(totals.outstanding).toBe(250)
  })

  it("excludes a Rejected payout from BOTH totals", () => {
    const { entries, totals } = fold({
      submissions: [
        submission({ id: "sub_ok", status: "Paid", total_amount: 100 }),
        submission({ id: "sub_no", status: "Rejected", total_amount: 999 }),
      ],
    })

    // Still rendered — a rejected claim is a thing that happened.
    expect(entries).toHaveLength(2)
    expect(totals.billed).toBe(100)
    expect(totals.outstanding).toBe(0)
  })

  it("interleaves both records into one chronological list", () => {
    const { entries } = fold({
      submissions: [submission({ submitted_at: "2026-08-28T08:00:00.000Z" })],
      payments: [payment({ payment_date: "2026-06-14T22:00:00.000Z" })],
    })

    expect(entries.map((e) => e.kind)).toEqual(["payout", "payment"])
  })

  it("orders a payout by when it was PAID, not when it was claimed", () => {
    const { entries } = fold({
      submissions: [
        submission({
          id: "sub_old_claim",
          status: "Paid",
          submitted_at: "2026-05-01T00:00:00.000Z",
          paid_at: "2026-07-01T00:00:00.000Z",
        }),
      ],
      payments: [payment({ payment_date: "2026-06-14T22:00:00.000Z" })],
    })

    expect(entries.map((e) => e.id)).toEqual([
      "payout:sub_old_claim",
      "payment:pay_1",
    ])
  })

  it("carries the payout's LINES so the panel labels it with the shared vocabulary", () => {
    const { entries } = fold({
      submissions: [submission()],
      items: [
        { id: "li_1", submission_id: "sub_1", source_type: "inventory_order" },
        { id: "li_2", submission_id: "sub_1", source_type: "run" },
        { id: "li_3", submission_id: "sub_other", source_type: "design" },
      ],
    })

    expect(entries[0].lines?.map((l) => l.id)).toEqual(["li_1", "li_2"])
  })

  it("refuses a single currency when the payouts disagree", () => {
    // A caller must not print "₹38,670 paid" over rupees plus euros.
    const { totals } = fold({
      submissions: [
        submission({ id: "a", currency: "inr" }),
        submission({ id: "b", currency: "eur" }),
      ],
    })

    expect(totals.currency).toBeNull()
  })

  it("keeps ids from colliding across the two records", () => {
    const { entries } = fold({
      submissions: [submission({ id: "same_id" })],
      payments: [payment({ id: "same_id" })],
    })

    expect(new Set(entries.map((e) => e.id)).size).toBe(2)
  })
})
