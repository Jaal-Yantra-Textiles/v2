import { foldPartnerLedger, mergePaymentSources } from "../fold"

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

/**
 * #1710 — one fact, two homes, no reconciliation.
 *
 * The exact prod shape: partner `01KKB7C2FY…` (Parmar), inventory order
 * `inv_order_01KWAKAZE1…`, submission `01M13T9D9A…` (Approved, INR 28,200 —
 * the ordered total), and two Completed INR 10,000 payments that linked to the
 * ORDER and never to the partner. The order page read `recorded: 20000`; the
 * partner ledger read `recorded: 0, outstanding: 28200`. That second reading is
 * the one that pays someone twice.
 */
describe("foldPartnerLedger — money recorded against an order a payout bills (#1710)", () => {
  const ORDER = "inv_order_01KWAKAZE17CC95XDEY7Q0M8SN"

  const parmarSubmission = {
    id: "01M13T9D9AGDA3QJYCXEZ942W7",
    status: "Approved",
    total_amount: 28200,
    currency: "inr",
    submitted_at: "2026-08-28T10:00:00.000Z",
  }

  const parmarLine = {
    id: "item_1",
    submission_id: "01M13T9D9AGDA3QJYCXEZ942W7",
    source_type: "inventory_order",
    inventory_order_id: ORDER,
    inventory_order_name: "Parmar cotton",
  }

  /** Both real rows: 11 Jul and 30 Aug, INR 10,000 each, Completed. */
  const orderPayments = [
    {
      id: "pay_jul",
      amount: 10000,
      status: "Completed",
      payment_type: "Bank",
      payment_date: "2026-07-11T00:00:00.000Z",
      inventory_order_id: ORDER,
      inventory_order_name: "Parmar cotton",
    },
    {
      id: "pay_aug",
      amount: 10000,
      status: "Completed",
      payment_type: "Bank",
      payment_date: "2026-08-30T00:00:00.000Z",
      inventory_order_id: ORDER,
      inventory_order_name: "Parmar cotton",
    },
  ]

  const parmar = (over: Record<string, any> = {}) =>
    foldPartnerLedger({
      submissions: [parmarSubmission],
      items: [parmarLine],
      payments: orderPayments,
      reconciliations: [],
      ...over,
    })

  it("SEES money that reached the ledger only through the inventory order", () => {
    /**
     * ⚠️ The union that makes these rows VISIBLE is `mergePaymentSources`, not
     * this fold — handing the fold a payments array asserts nothing about where
     * it came from. So drive it the way the route does: a partner link that
     * returns NOTHING, and the order link that returns both rows.
     */
    const payments = mergePaymentSources([
      { rows: [] },
      {
        rows: [{ id: "pay_jul", amount: 10000, status: "Completed" }],
        attribution: { inventory_order_id: ORDER, inventory_order_name: "Parmar cotton" },
      },
      {
        rows: [{ id: "pay_aug", amount: 10000, status: "Completed" }],
        attribution: { inventory_order_id: ORDER, inventory_order_name: "Parmar cotton" },
      },
    ])

    const { totals } = parmar({ payments })

    // Before #1710 the route read the partner link ALONE, which returns [] for
    // both of these — so this was 0 while the order page said 20,000.
    expect(totals.recorded).toBe(20000)
    expect(totals.recorded_against_open).toBe(20000)
  })

  it("warns on the payout that INR 20,000 already sits against the order it bills", () => {
    const { entries } = parmar()

    const payout = entries.find((e) => e.kind === "payout")!
    expect(payout.recorded_against_total).toBe(20000)
    expect(payout.recorded_against).toHaveLength(2)
    expect(payout.recorded_against!.map((r) => r.payment_id).sort()).toEqual([
      "pay_aug",
      "pay_jul",
    ])
    expect(payout.recorded_against![0].via).toBe("inventory_order")
    expect(payout.recorded_against![0].inventory_order_name).toBe(
      "Parmar cotton"
    )
  })

  it("does NOT net that money off `outstanding` — an advance and a payout can coexist", () => {
    const { totals } = parmar()

    // The founder decides whether these INR 20,000 discharge the payout, by
    // linking the payment to the submission. This fold must not infer it from a
    // shared order id.
    expect(totals.billed).toBe(28200)
    expect(totals.paid).toBe(0)
    expect(totals.outstanding).toBe(28200)
    // …but it must say so, right beside it.
    expect(totals.recorded_against_open).toBe(20000)
  })

  it("counts a payment ONCE when two open payouts bill the same order", () => {
    const second = {
      ...parmarSubmission,
      id: "sub_2",
      total_amount: 5000,
    }
    const { totals } = parmar({
      submissions: [parmarSubmission, second],
      items: [parmarLine, { ...parmarLine, id: "item_2", submission_id: "sub_2" }],
    })

    // Two payouts mention the order; the money moved once.
    expect(totals.recorded_against_open).toBe(20000)
  })

  it("stops warning once the payout is Paid — settled money is history, not risk", () => {
    // The control: while it is Approved the warning is loud.
    expect(parmar().totals.recorded_against_open).toBe(20000)

    const { totals } = parmar({
      submissions: [{ ...parmarSubmission, status: "Paid", paid_at: "2026-08-31T00:00:00.000Z" }],
    })

    expect(totals.paid).toBe(28200)
    expect(totals.recorded_against_open).toBe(0)
    // Still visible as recorded money — it did move.
    expect(totals.recorded).toBe(20000)
  })

  it("keeps the order on the payment entry, so a reader can see WHY it is there", () => {
    const { entries } = parmar()

    const payment = entries.find((e) => e.id === "payment:pay_jul")!
    expect(payment.inventory_order_id).toBe(ORDER)
    expect(payment.inventory_order_name).toBe("Parmar cotton")

    // The control: a payment with no order stays null rather than inheriting
    // the order of whichever row was folded beside it.
    const { entries: bare } = parmar({
      payments: [{ id: "pay_bare", amount: 500, status: "Completed" }],
    })
    expect(bare.find((e) => e.id === "payment:pay_bare")!.inventory_order_id).toBeNull()
  })

  it("attaches a payment that NAMES its payout, and drops it from `recorded`", () => {
    // The direct link — the fact a human states. Same money, now matched.
    const { entries, totals } = parmar({
      payments: [
        { ...orderPayments[0], submission_id: "01M13T9D9AGDA3QJYCXEZ942W7" },
        orderPayments[1],
      ],
    })

    const payout = entries.find((e) => e.kind === "payout")!
    expect(payout.settled_by?.payment_id).toBe("pay_jul")

    // It is described on its payout, so it is no longer "recorded separately"…
    expect(totals.recorded).toBe(10000)
    // …nor is it double-reported as unmatched money against the same order.
    expect(payout.recorded_against!.map((r) => r.payment_id)).toEqual(["pay_aug"])
    expect(totals.recorded_against_open).toBe(10000)
  })

  it("ignores a direct link that names a submission belonging to someone else", () => {
    // The control: the SAME row, naming THIS partner's payout, does attach.
    const attached = parmar({
      payments: [{ ...orderPayments[0], submission_id: parmarSubmission.id }],
    })
    expect(
      attached.entries.find((e) => e.kind === "payout")!.settled_by?.payment_id
    ).toBe("pay_jul")

    const { entries, totals } = parmar({
      payments: [{ ...orderPayments[0], submission_id: "sub_of_another_partner" }],
    })

    const payout = entries.find((e) => e.kind === "payout")!
    expect(payout.settled_by).toBeNull()
    // Still this partner's money, still visible.
    expect(totals.recorded).toBe(10000)
  })
})

/**
 * The union itself (#1710) — which decides whether money is VISIBLE at all,
 * before any arithmetic runs on it.
 */
describe("mergePaymentSources", () => {
  it("returns a row that only ONE source knows about", () => {
    const merged = mergePaymentSources([
      { rows: [] },
      { rows: [{ id: "p1", amount: 10000 }], attribution: { inventory_order_id: "o1" } },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].inventory_order_id).toBe("o1")
  })

  it("counts a row present in TWO sources once", () => {
    const merged = mergePaymentSources([
      { rows: [{ id: "p1", amount: 10000 }] },
      { rows: [{ id: "p1", amount: 10000 }], attribution: { inventory_order_id: "o1" } },
    ])

    expect(merged).toHaveLength(1)
    // …and the later source still teaches it which order it was recorded against.
    expect(merged[0].inventory_order_id).toBe("o1")
  })

  it("lets a later source FILL IN a missing field but never OVERWRITE one", () => {
    const merged = mergePaymentSources([
      { rows: [{ id: "p1" }], attribution: { inventory_order_id: "o_first" } },
      { rows: [{ id: "p1" }], attribution: { inventory_order_id: "o_second", submission_id: "s1" } },
    ])

    expect(merged[0].inventory_order_id).toBe("o_first")
    expect(merged[0].submission_id).toBe("s1")
  })

  it("does not let a null attribution erase a value already present", () => {
    const merged = mergePaymentSources([
      { rows: [{ id: "p1", inventory_order_name: "Parmar cotton" }] },
      { rows: [{ id: "p1" }], attribution: { inventory_order_name: null } },
    ])

    expect(merged[0].inventory_order_name).toBe("Parmar cotton")
  })

  it("skips rows with no id rather than collapsing them into one", () => {
    const merged = mergePaymentSources([{ rows: [{ amount: 1 }, null, undefined] as any }])
    expect(merged).toEqual([])
  })
})

/**
 * PARTIAL settlement (#1710) — the reading the founder asked for.
 *
 * Parmar's payout is INR 28,200 and INR 20,000 has demonstrably moved. Before
 * this, the model had no honest way to say so: `Approved` reports 0 paid and
 * 28,200 outstanding — the reading that pays someone twice — while flipping it
 * to `Paid` would claim 28,200 moved when 8,200 is still owed.
 *
 * 🔑 Linking a payment to the payout it settles is the human statement that
 * makes the partial expressible. It is not inference: nothing here derives it
 * from a shared order id.
 */
describe("foldPartnerLedger — a payout settled in PART (#1710)", () => {
  const sub = {
    id: "sub_28200",
    status: "Approved",
    total_amount: 28200,
    currency: "inr",
    submitted_at: "2026-08-28T10:00:00.000Z",
  }

  const linked = (over: Record<string, any> = {}) => ({
    id: "pay_jul",
    amount: 10000,
    status: "Completed",
    submission_id: "sub_28200",
    ...over,
  })

  const fold = (payments: any[]) =>
    foldPartnerLedger({
      submissions: [sub],
      items: [],
      payments,
      reconciliations: [],
    })

  it("counts linked money as paid, and owes only the remainder", () => {
    const { totals } = fold([linked(), linked({ id: "pay_aug" })])

    expect(totals.billed).toBe(28200)
    expect(totals.paid).toBe(20000)
    expect(totals.outstanding).toBe(8200)
  })

  it("leaves an UNLINKED payment out of paid — that is the whole distinction", () => {
    // Same money, same order, no statement that it settles this payout.
    const { totals } = fold([
      { id: "pay_jul", amount: 10000, status: "Completed" },
      { id: "pay_aug", amount: 10000, status: "Completed" },
    ])

    expect(totals.paid).toBe(0)
    expect(totals.outstanding).toBe(28200)
    expect(totals.recorded).toBe(20000)
  })

  it("does not let a bounced payment settle anything", () => {
    const { totals } = fold([
      linked({ id: "pay_failed", status: "Failed" }),
      linked({ id: "pay_cancelled", status: "Cancelled" }),
      linked({ id: "pay_real" }),
    ])

    // Only the one that moved.
    expect(totals.paid).toBe(10000)
    expect(totals.outstanding).toBe(18200)
  })

  it("🔴 does not let a PENDING payment settle anything either", () => {
    /**
     * The status a partner's own submission is written with. If Pending
     * settled, a partner could move their own `paid` figure by asserting they
     * had been paid — the admin marking it `Completed` is the only control on
     * that, and it is deliberately a human act (#1639's rule, applied to the
     * link).
     */
    const { totals, entries } = fold([
      linked({ id: "pay_pending", status: "Pending" }),
    ])

    expect(entries.find((e) => e.kind === "payout")!.settled_amount).toBe(0)
    expect(totals.paid).toBe(0)
    expect(totals.outstanding).toBe(28200)
  })

  it("warns on a Pending payment even though it cannot settle — warn wide, settle narrow", () => {
    /**
     * ⚠️ The two rules are deliberately different. `recorded_against_open`
     * counts Pending because a warning should over-fire; `paid` refuses it
     * because a settlement must not.
     */
    const { totals } = foldPartnerLedger({
      submissions: [sub],
      items: [{ id: "i1", submission_id: "sub_28200", source_type: "inventory_order", inventory_order_id: "o1" }],
      payments: [
        { id: "pay_pending", amount: 10000, status: "Pending", inventory_order_id: "o1" },
      ],
      reconciliations: [],
    })

    expect(totals.paid).toBe(0)
    expect(totals.recorded_against_open).toBe(10000)
  })

  it("caps settlement at the payout's own amount", () => {
    // A INR 30,000 payment cannot make a INR 28,200 payout overpaid; the
    // surplus belongs to something else.
    const { totals, entries } = fold([linked({ amount: 30000 })])

    expect(entries.find((e) => e.kind === "payout")!.settled_amount).toBe(28200)
    expect(totals.paid).toBe(28200)
    expect(totals.outstanding).toBe(0)
  })

  it("does NOT double-count a Paid payout that also carries a link", () => {
    /**
     * 🔴 The regression this guards. If status and links both contributed, a
     * settled payout with its payment linked would report 38,200 paid against
     * 28,200 billed and a NEGATIVE outstanding.
     */
    const { totals } = foldPartnerLedger({
      submissions: [{ ...sub, status: "Paid", paid_at: "2026-08-31T00:00:00.000Z" }],
      items: [],
      payments: [linked()],
      reconciliations: [],
    })

    expect(totals.paid).toBe(28200)
    expect(totals.outstanding).toBe(0)
  })

  it("keeps a RECONCILIATION-derived association out of paid", () => {
    /**
     * ⚠️ Provenance, not a statement of how much is discharged. Letting it move
     * `paid` would silently restate historical numbers nobody re-examined.
     */
    const { totals } = foldPartnerLedger({
      submissions: [sub],
      items: [],
      payments: [{ id: "pay_hist", amount: 10000, status: "Pending" }],
      reconciliations: [
        { reference_type: "payment_submission", reference_id: "sub_28200", payment_id: "pay_hist" },
      ],
    })

    expect(totals.paid).toBe(0)
    expect(totals.outstanding).toBe(28200)
  })

  it("still reports a Rejected payout as neither billed nor paid", () => {
    const { totals } = foldPartnerLedger({
      submissions: [{ ...sub, status: "Rejected" }],
      items: [],
      payments: [linked()],
      reconciliations: [],
    })

    expect(totals.billed).toBe(0)
    expect(totals.paid).toBe(0)
  })
})

/**
 * Applying a credit to a payout (#1712).
 *
 * hrhandloom's real shape: 1,380 already in their hands from being paid 30,000
 * against a 28,620 payout, now named against a later claim.
 */
describe("foldPartnerLedger — applied credits (#1712)", () => {
  const sub = (over: Record<string, any> = {}) => ({
    id: "sub_10000",
    status: "Approved",
    total_amount: 10000,
    currency: "inr",
    submitted_at: "2026-09-01T00:00:00.000Z",
    ...over,
  })

  const credit = (over: Record<string, any> = {}) => ({
    id: "cred_1380",
    amount: 1380,
    status: "Applied",
    currency_code: "inr",
    reason: "Overpaid 30,000 against a 28,620 payout",
    applied_to_submission_id: "sub_10000",
    applied_at: "2026-09-02T00:00:00.000Z",
    ...over,
  })

  const fold = (over: Record<string, any> = {}) =>
    foldPartnerLedger({
      submissions: [sub()],
      items: [],
      payments: [],
      reconciliations: [],
      ...over,
    })

  it("reduces what the payout still claims", () => {
    const { totals } = fold({ credits: [credit()] })

    expect(totals.billed).toBe(10000)
    expect(totals.paid).toBe(0)
    expect(totals.credited).toBe(1380)
    expect(totals.outstanding).toBe(8620)
  })

  /**
   * 🔑 Kept OUT of `paid`. `paid` means money that moved against these payouts;
   * a founder reconciling this screen against a bank statement must not find a
   * figure no statement can explain.
   */
  it("does NOT inflate paid", () => {
    expect(fold({ credits: [credit()] }).totals.paid).toBe(0)
  })

  it("attaches the credit to the payout it discharged", () => {
    const { entries } = fold({ credits: [credit()] })
    const payout = entries.find((e) => e.kind === "payout")!

    expect(payout.credited_amount).toBe(1380)
    expect(payout.credits_applied).toEqual([
      {
        credit_id: "cred_1380",
        amount: 1380,
        reason: "Overpaid 30,000 against a 28,620 payout",
        applied_at: "2026-09-02T00:00:00.000Z",
      },
    ])
  })

  it("ignores an Open credit — it has discharged nothing yet", () => {
    const { totals } = fold({
      credits: [credit({ status: "Open", applied_to_submission_id: null })],
    })

    expect(totals.credited).toBe(0)
    expect(totals.outstanding).toBe(10000)
  })

  it("ignores a credit applied to a DIFFERENT payout", () => {
    const { totals } = fold({
      credits: [credit({ applied_to_submission_id: "sub_other" })],
    })

    expect(totals.credited).toBe(0)
    expect(totals.outstanding).toBe(10000)
  })

  it("stacks with money settled against the same payout", () => {
    const { totals } = fold({
      payments: [
        {
          id: "pay_4000",
          amount: 4000,
          status: "Completed",
          submission_id: "sub_10000",
        },
      ],
      credits: [credit()],
    })

    expect(totals.paid).toBe(4000)
    expect(totals.credited).toBe(1380)
    expect(totals.outstanding).toBe(4620)
  })

  /**
   * ⚠️ A Paid payout contributes its whole amount to `paid`. Also subtracting a
   * credit would push `outstanding` negative and report the partner as overpaid
   * on a row that is simply settled. The apply route refuses to create this
   * state, but the ledger reads rows it did not write.
   */
  it("does not double-discharge a payout that is already Paid", () => {
    const { totals } = fold({
      submissions: [sub({ status: "Paid", paid_at: "2026-09-01T00:00:00.000Z" })],
      credits: [credit()],
    })

    expect(totals.paid).toBe(10000)
    expect(totals.credited).toBe(0)
    expect(totals.outstanding).toBe(0)
  })

  /**
   * Every caller that predates credits keeps its meaning — a ledger folded
   * without them reports exactly what it reported before they existed.
   */
  it("reports credited: 0 when no credits are passed at all", () => {
    const { totals } = fold()
    expect(totals.credited).toBe(0)
    expect(totals.outstanding).toBe(10000)
  })
})
