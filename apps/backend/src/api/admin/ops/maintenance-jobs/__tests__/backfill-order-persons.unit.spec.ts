import {
  backfillOrderPersonsJob,
  decideOrderPersonBackfill,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_ORDER_PERSON_BACKFILL,
  summarizeOrderPersonBackfill,
} from "../registry"

/**
 * #664 — pure decision/summary logic for the `backfill-order-persons` job. The
 * container-bound run() (query.graph over orders + Person upsert + conversion
 * update) is exercised by the API contract integration test; here we lock down
 * the link / create / skip decision and the summary string without booting the DB.
 */
describe("backfill-order-persons — decideOrderPersonBackfill", () => {
  const order_id = "order_1"

  it("skips a conversion that already has a person_id (idempotent)", () => {
    expect(
      decideOrderPersonBackfill({
        conversion: { person_id: "per_1", order_id },
        email: "a@b.com",
        existingPersonId: null,
      })
    ).toEqual({ action: "skip", reason: "already linked" })
  })

  it("skips when there is no order_id to resolve an email from", () => {
    expect(
      decideOrderPersonBackfill({
        conversion: { person_id: null, order_id: null },
        email: null,
        existingPersonId: null,
      })
    ).toEqual({ action: "skip", reason: "no order_id" })
  })

  it("skips when the order has no usable email", () => {
    expect(
      decideOrderPersonBackfill({
        conversion: { person_id: null, order_id },
        email: "not-an-email",
        existingPersonId: null,
      })
    ).toEqual({ action: "skip", reason: "no usable email" })
  })

  it("links to an existing Person when the email matches", () => {
    expect(
      decideOrderPersonBackfill({
        conversion: { person_id: null, order_id },
        email: "a@b.com",
        existingPersonId: "per_existing",
      })
    ).toEqual({ action: "link", person_id: "per_existing" })
  })

  it("creates a Person when the email is usable but unmatched", () => {
    expect(
      decideOrderPersonBackfill({
        conversion: { person_id: null, order_id },
        email: "a@b.com",
        existingPersonId: null,
      })
    ).toEqual({ action: "create" })
  })
})

describe("backfill-order-persons — summarizeOrderPersonBackfill", () => {
  it("reports nothing-to-do", () => {
    expect(summarizeOrderPersonBackfill(true, 5, 0, 0, 0)).toContain("No changes")
    expect(summarizeOrderPersonBackfill(true, 5, 0, 0, 2)).toContain("2 errored")
  })

  it("uses conditional verbs for dry-run vs apply and counts link/create", () => {
    const dry = summarizeOrderPersonBackfill(true, 10, 3, 4, 0)
    expect(dry).toContain("Would repair 7 of 10")
    expect(dry).toContain("would link 3")
    expect(dry).toContain("would create 4")

    const applied = summarizeOrderPersonBackfill(false, 10, 3, 4, 1)
    expect(applied).toContain("Repaired 7 of 10")
    expect(applied).toContain("linked 3")
    expect(applied).toContain("created 4")
    expect(applied).toContain("1 errored")
  })
})

describe("backfill-order-persons — registration", () => {
  it("is registered in MAINTENANCE_JOBS and resolvable by id", () => {
    expect(MAINTENANCE_JOBS).toContain(backfillOrderPersonsJob)
    expect(getMaintenanceJob("backfill-order-persons")).toBe(backfillOrderPersonsJob)
  })

  it("declares limit + order_id params and a sane cap", () => {
    expect(backfillOrderPersonsJob.params.map((p) => p.name)).toEqual([
      "limit",
      "order_id",
    ])
    expect(MAX_ORDER_PERSON_BACKFILL).toBe(1000)
  })
})
