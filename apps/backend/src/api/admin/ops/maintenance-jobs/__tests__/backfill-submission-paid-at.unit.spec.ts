import { backfillSubmissionPaidAtJob } from "../backfill-submission-paid-at-job"

/**
 * #1639 — stamp `paid_at` on payouts settled before the column existed.
 *
 * Driven against a fake container so the WRITE SHAPE is asserted, not merely
 * the decision to write. The job's central claim is about what it REFUSES to
 * do: a payout with no settlement evidence must be left null rather than dated
 * from whatever timestamp happens to be nearby.
 */

const SETTLED_AT = new Date("2026-08-28T08:38:20.733Z")

type Recon = Record<string, any>
type Sub = Record<string, any>

const makeContainer = (opts: { recons: Recon[]; subs: Sub[] }) => {
  const updatePaymentSubmissions = jest.fn().mockResolvedValue(undefined)

  const listPaymentReconciliations = jest.fn(async (filters: any) => {
    return opts.recons.filter(
      (r) =>
        r.reference_type === filters.reference_type &&
        r.status === filters.status
    )
  })

  const listPaymentSubmissions = jest.fn(async ({ id }: any) =>
    opts.subs.filter((s) => id.includes(s.id))
  )

  return {
    updatePaymentSubmissions,
    container: {
      resolve: (key: string) => {
        if (key === "payment_reports") return { listPaymentReconciliations }
        if (key === "payment_submissions") {
          return { listPaymentSubmissions, updatePaymentSubmissions }
        }
        throw new Error(`unexpected resolve(${key})`)
      },
    },
  }
}

const recon = (over: Partial<Recon> = {}): Recon => ({
  id: "rec_1",
  reference_type: "payment_submission",
  reference_id: "sub_1",
  status: "Settled",
  settled_at: SETTLED_AT,
  settled_by: "user_1",
  ...over,
})

const sub = (over: Partial<Sub> = {}): Sub => ({
  id: "sub_1",
  status: "Paid",
  paid_at: null,
  ...over,
})

describe("backfill-submission-paid-at (#1639)", () => {
  it("stamps paid_at from the reconciliation's settled_at", async () => {
    const { container, updatePaymentSubmissions } = makeContainer({
      recons: [recon()],
      subs: [sub()],
    })

    const res = await backfillSubmissionPaidAtJob.run(container, {
      dry_run: false,
      params: {},
    })

    expect(res.changes).toHaveLength(1)
    expect(res.changes[0]).toMatchObject({
      entity: "payment_submission",
      id: "sub_1",
      field: "paid_at",
      before: null,
      after: SETTLED_AT,
    })
    expect(updatePaymentSubmissions).toHaveBeenCalledWith({
      id: "sub_1",
      paid_at: SETTLED_AT,
    })
    expect(res.applied).toBe(true)
  })

  it("writes NOTHING on a dry run, while still reporting what it would do", async () => {
    const { container, updatePaymentSubmissions } = makeContainer({
      recons: [recon()],
      subs: [sub()],
    })

    const res = await backfillSubmissionPaidAtJob.run(container, {
      dry_run: true,
      params: {},
    })

    expect(res.changes).toHaveLength(1)
    expect(res.applied).toBe(false)
    expect(updatePaymentSubmissions).not.toHaveBeenCalled()
  })

  /**
   * 🔴 The assertion the whole job exists to keep honest.
   *
   * An unsettled payout has no evidence of when its money moved. A null
   * `paid_at` says exactly that; any date written here would read as fact.
   */
  it("skips a payout whose reconciliation is not Settled", async () => {
    const { container, updatePaymentSubmissions } = makeContainer({
      recons: [recon({ status: "Matched", settled_at: null })],
      subs: [sub({ status: "Approved" })],
    })

    const res = await backfillSubmissionPaidAtJob.run(container, {
      dry_run: false,
      params: {},
    })

    expect(res.changes).toHaveLength(0)
    expect(updatePaymentSubmissions).not.toHaveBeenCalled()
  })

  it("reports a Settled row carrying no settled_at instead of dating it from elsewhere", async () => {
    const { container, updatePaymentSubmissions } = makeContainer({
      recons: [recon({ settled_at: null })],
      subs: [sub()],
    })

    const res = await backfillSubmissionPaidAtJob.run(container, {
      dry_run: false,
      params: {},
    })

    expect(res.changes).toHaveLength(0)
    expect(updatePaymentSubmissions).not.toHaveBeenCalled()
    expect(res.summary).toContain("settled WITHOUT a settled_at")
    expect(res.summary).toContain("sub_1")
  })

  it("leaves a payout that already carries a paid_at alone, so it is safe to re-run", async () => {
    const existing = new Date("2026-01-01T00:00:00.000Z")
    const { container, updatePaymentSubmissions } = makeContainer({
      recons: [recon()],
      subs: [sub({ paid_at: existing })],
    })

    const res = await backfillSubmissionPaidAtJob.run(container, {
      dry_run: false,
      params: {},
    })

    expect(res.changes).toHaveLength(0)
    expect(updatePaymentSubmissions).not.toHaveBeenCalled()
    expect(res.summary).toContain("1 already carried one")
  })

  it("honours limit, so a first pass can be bounded", async () => {
    const { container } = makeContainer({
      recons: [
        recon({ id: "rec_1", reference_id: "sub_1" }),
        recon({ id: "rec_2", reference_id: "sub_2" }),
        recon({ id: "rec_3", reference_id: "sub_3" }),
      ],
      subs: [sub({ id: "sub_1" }), sub({ id: "sub_2" }), sub({ id: "sub_3" })],
    })

    const res = await backfillSubmissionPaidAtJob.run(container, {
      dry_run: true,
      params: { limit: 2 },
    })

    expect(res.changes).toHaveLength(2)
  })

  it("states WHY each row was chosen, so a dry run can be argued with", async () => {
    const { container } = makeContainer({
      recons: [recon()],
      subs: [sub()],
    })

    const res = await backfillSubmissionPaidAtJob.run(container, {
      dry_run: true,
      params: {},
    })

    expect(res.changes[0].note).toContain("rec_1")
    expect(res.changes[0].note).toContain("Settled")
    expect(res.changes[0].note).toContain("user_1")
  })
})
