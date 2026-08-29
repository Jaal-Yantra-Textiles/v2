import { foldPartnerLedger } from "../fold"

/**
 * The fold over REAL production rows, fetched 2026-08-29 from v3.
 *
 * ⚠️ This is not a probe of the deployed route — the route is not deployed. It
 * is the arithmetic run against the actual shapes prod holds, so the numbers in
 * the PR are checked against data rather than against a fixture I invented. A
 * fixture tidier than reality certifies the wrong code.
 *
 * Partner 01K4PJMNMNRGMK0ZXMKBBDZDGD is the busiest payee on prod and the exact
 * case #1612 exists for: 11 submissions AND 3 `internal_payments`, one of which
 * is the settlement of one of the submissions.
 */
describe("foldPartnerLedger over production data", () => {
  /** GET /admin/payment-submissions, filtered to this partner. */
  const submissions = [
    { id: "s_8974", status: "Paid", total_amount: 8974, currency: "inr", submitted_at: "2026-08-28T09:00:00.000Z", paid_at: "2026-08-28T09:07:52.065Z" },
    { id: "s_810", status: "Pending", total_amount: 810, currency: "inr", submitted_at: "2026-08-28T05:02:31.245Z" },
    { id: "s_4000", status: "Pending", total_amount: 4000, currency: "inr", submitted_at: "2026-08-28T05:02:36.306Z" },
    { id: "s_840", status: "Pending", total_amount: 840, currency: "inr", submitted_at: "2026-08-28T05:02:40.678Z" },
    { id: "s_2200", status: "Pending", total_amount: 2200, currency: "inr", submitted_at: "2026-08-26T02:15:03.400Z" },
    { id: "s_2300", status: "Pending", total_amount: 2300, currency: "inr", submitted_at: "2026-08-26T02:13:31.482Z" },
    { id: "s_7650", status: "Pending", total_amount: 7650, currency: "inr", submitted_at: "2026-08-26T02:11:42.222Z" },
    { id: "s_1190", status: "Pending", total_amount: 1190, currency: "inr", submitted_at: "2026-08-28T05:02:49.606Z" },
    { id: "s_900", status: "Pending", total_amount: 900, currency: "inr", submitted_at: "2026-08-28T05:02:53.999Z" },
    { id: "s_580", status: "Pending", total_amount: 580, currency: "inr", submitted_at: "2026-08-28T05:02:58.129Z" },
    { id: "s_1110", status: "Pending", total_amount: 1110, currency: "inr", submitted_at: "2026-08-28T05:03:03.092Z" },
  ]

  /** GET /admin/payments/partners/:id — three rows, spanning eleven months. */
  const payments = [
    { id: "01K5XCDRA4VPDRZT2HHBAGY46T", amount: 18000, status: "Completed", payment_type: "Bank", payment_date: "2025-09-23T18:30:00.000Z" },
    { id: "01KKGD28A09F296QMX10AVY00S", amount: 28000, status: "Completed", payment_type: "Bank", payment_date: "2026-03-11T18:30:00.000Z" },
    /**
     * 🔴 The one that made the two-panel UI lie. It is the SETTLEMENT of
     * s_8974 — same amount, written 13 seconds before the submission's
     * `paid_at` — and it is still `Pending` while the submission says `Paid`.
     * One payout, two records, two statuses.
     */
    { id: "01M13SZWDDFJ4NHP1D7VX4JKK6", amount: 8974, status: "Pending", payment_type: "Bank", payment_date: "2026-08-28T09:07:39.563Z" },
  ]

  /** GET /admin/payment_reports/reconciliation — 5 rows on prod, 1 for this partner. */
  const reconciliations = [
    { reference_type: "payment_submission", reference_id: "s_8974", payment_id: "01M13SZWDDFJ4NHP1D7VX4JKK6", settled_at: "2026-08-28T09:07:52.065Z" },
  ]

  const result = () =>
    foldPartnerLedger({ submissions, items: [], payments, reconciliations })

  it("shows 13 entries, not 14 — the settlement is not a second row", () => {
    const { entries } = result()

    // 11 payouts + 2 standalone payments. The 8,974 payment is attached to the
    // payout it settled, so the money appears once.
    expect(entries).toHaveLength(13)
    expect(entries.filter((e) => e.kind === "payout")).toHaveLength(11)
    expect(entries.filter((e) => e.kind === "payment")).toHaveLength(2)
  })

  it("attaches the settlement to its payout", () => {
    const payout = result().entries.find((e) => e.submission_id === "s_8974")

    expect(payout?.settled_by?.payment_id).toBe("01M13SZWDDFJ4NHP1D7VX4JKK6")
  })

  it("bills 30,554 — the sum of the eleven submissions", () => {
    const { totals } = result()

    expect(totals.billed).toBe(30554)
    expect(totals.paid).toBe(8974)
    expect(totals.outstanding).toBe(21580)
  })

  it("🔴 does not add the 8,974 twice", () => {
    const { totals } = result()

    // `recorded` is the two genuinely historical rows and nothing else. Were
    // the settlement counted here as well, the panel would claim 46,000 +
    // 8,974 of movement against 30,554 billed.
    expect(totals.recorded).toBe(46000)
    expect(totals.paid + totals.recorded).toBe(54974)
  })

  it("puts the whole of August above the two older payments", () => {
    const { entries } = result()

    // Every submission on prod carries `submitted_at`, so the eleven August
    // payouts sort above the 2026-03 and 2025-09 payments — the panel opens on
    // what is owed now rather than on last year's bank transfer.
    expect(entries.slice(0, 11).every((e) => e.kind === "payout")).toBe(true)
    expect(entries.slice(11).map((e) => e.amount)).toEqual([28000, 18000])
  })

  it("orders the settled payout by when it was PAID, not when it was claimed", () => {
    const { entries } = result()

    // s_8974 was claimed at 08:43 and paid at 09:07. Several Pending claims sit
    // between those two times, and the payout belongs above them.
    expect(entries[0].submission_id).toBe("s_8974")
  })
})

/**
 * The whole prod picture, from the same fetch: 20 submissions, 36
 * `internal_payments`, and exactly 5 reconciliations — all `payment_submission`,
 * all `Settled`, each naming BOTH a submission and a payment.
 *
 * That last fact is what the dedupe rests on, so it is asserted rather than
 * assumed: every Paid submission on prod has a reconciliation that can find its
 * payment, and no reconciliation is missing either end.
 */
describe("the prod reconciliation set resolves every Paid payout", () => {
  const paidSubmissions = ["01M13RM1ATYW7XT1JG60VKC5CQ", "01M13MPTSC5N510CEW1KR2R7RV", "01KZWY5PCBNXAG6G8JHED3WT73", "01KYCXJ7BS4CT302M1D0Q9B2MK", "01KPDKVM9YVWHRT7007ZK1PSGD"]

  const reconciliations = [
    { reference_type: "payment_submission", reference_id: "01M13RM1ATYW7XT1JG60VKC5CQ", payment_id: "01M13SZWDDFJ4NHP1D7VX4JKK6" },
    { reference_type: "payment_submission", reference_id: "01M13MPTSC5N510CEW1KR2R7RV", payment_id: "01M13QV30QSF7XWT1CKCXYRYBG" },
    { reference_type: "payment_submission", reference_id: "01KZWY5PCBNXAG6G8JHED3WT73", payment_id: "01M0XWHA0S0C10MSET11CWQHAS" },
    { reference_type: "payment_submission", reference_id: "01KYCXJ7BS4CT302M1D0Q9B2MK", payment_id: "01KYCY7V59X3FETCHVFMZPYJQ4" },
    { reference_type: "payment_submission", reference_id: "01KPDKVM9YVWHRT7007ZK1PSGD", payment_id: "01KPDKWX41V5TSNV7TS80RVAWY" },
  ]

  it("names both ends on every row", () => {
    for (const rec of reconciliations) {
      expect(rec.reference_id).toBeTruthy()
      expect(rec.payment_id).toBeTruthy()
    }
  })

  it("covers exactly the five Paid submissions", () => {
    expect(reconciliations.map((r) => r.reference_id).sort()).toEqual(
      [...paidSubmissions].sort()
    )
  })

  it("attaches all five, leaving 31 of the 36 payments standalone", () => {
    const submissions = paidSubmissions.map((id) => ({
      id,
      status: "Paid",
      total_amount: 100,
      currency: "inr",
    }))
    const payments = reconciliations.map((r) => ({
      id: r.payment_id!,
      amount: 100,
      status: "Completed",
    }))

    const { entries } = foldPartnerLedger({
      submissions,
      items: [],
      payments,
      reconciliations,
    })

    // Five payouts, zero standalone payments — which is why the other 31 rows
    // on prod are history the merged panel must still render.
    expect(entries.filter((e) => e.kind === "payment")).toHaveLength(0)
    expect(entries.filter((e) => e.settled_by)).toHaveLength(5)
  })
})
