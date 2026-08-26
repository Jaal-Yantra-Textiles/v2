import { classifyAppliedBackfill } from "../backfill-consumption-applied-columns-job"

/**
 * `inventory_applied_at` is the idempotency guard on stock deduction. A wrong
 * verdict here is not a reporting error — "never_applied" on an applied log
 * means the apply job takes the same material off the shelf twice.
 */
describe("classifyAppliedBackfill", () => {
  it("fills the column when only the legacy metadata key carries a stamp", () => {
    expect(
      classifyAppliedBackfill({
        column_at: null,
        metadata_at: "2026-08-15T06:37:24.597Z",
      }).verdict
    ).toBe("fill")
  })

  it("treats a Date column and its ISO metadata twin as the same instant", () => {
    // The column round-trips through timestamptz and comes back as a Date; the
    // metadata value is the string the apply job wrote. Comparing them as
    // strings would call every migrated row a conflict and report the whole
    // table as needing a human.
    const iso = "2026-08-15T06:37:24.597Z"

    expect(
      classifyAppliedBackfill({ column_at: new Date(iso), metadata_at: iso })
        .verdict
    ).toBe("already_migrated")
  })

  it("reports genuinely different timestamps as a conflict rather than picking one", () => {
    expect(
      classifyAppliedBackfill({
        column_at: "2026-08-15T06:37:24.597Z",
        metadata_at: "2026-08-16T09:00:00.000Z",
      }).verdict
    ).toBe("conflict")
  })

  it("says never_applied only when NEITHER side carries a stamp", () => {
    expect(
      classifyAppliedBackfill({ column_at: null, metadata_at: null }).verdict
    ).toBe("never_applied")
    expect(
      classifyAppliedBackfill({ column_at: undefined, metadata_at: undefined })
        .verdict
    ).toBe("never_applied")
  })

  it("does not treat an empty-string stamp as an applied log", () => {
    // "" is not a time. Reading it as one would make the row look applied and
    // strand real stock; reading the pair as unstamped is the honest answer.
    expect(
      classifyAppliedBackfill({ column_at: "", metadata_at: "" }).verdict
    ).toBe("never_applied")
  })

  it("leaves a column-only row alone when metadata was never written", () => {
    expect(
      classifyAppliedBackfill({
        column_at: "2026-08-15T06:37:24.597Z",
        metadata_at: null,
      }).verdict
    ).toBe("already_migrated")
  })

  it("does not classify an unparseable stamp as a valid instant", () => {
    // A garbage value must not silently compare equal to another garbage value
    // and report "already migrated" over a row nobody has checked.
    expect(
      classifyAppliedBackfill({ column_at: null, metadata_at: "not-a-date" })
        .verdict
    ).toBe("never_applied")
  })
})
