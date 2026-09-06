import { erroredBindings, neverSynced, type BindingLike } from "../absence"

const binding = (over: Partial<BindingLike> = {}): BindingLike => ({
  id: over.id ?? "b1",
  status: "active",
  last_synced_at: "2026-09-01T00:00:00Z",
  last_error: null,
  ...over,
})

describe("neverSynced", () => {
  it("finds an active binding that has never brought anything back", () => {
    /*
     * The measured case: 49 `search-console` bindings, all `active`, all with
     * `last_synced_at` null. `status` is set at creation, so a binding that
     * never worked looks exactly like one syncing every hour.
     */
    expect(
      neverSynced([binding({ id: "b1", last_synced_at: null })]).map((b) => b.id)
    ).toEqual(["b1"])
  })

  it("treats an undefined timestamp the same as null", () => {
    // A field the query did not select comes back undefined, not null.
    expect(neverSynced([binding({ last_synced_at: undefined })])).toHaveLength(1)
  })

  it("ignores one that has synced", () => {
    expect(neverSynced([binding()])).toHaveLength(0)
  })

  it("ignores a binding that is not active", () => {
    // 🔴 A paused or pending binding is not expected to have synced. Only
    // `active` makes the claim that this rule contradicts.
    for (const status of ["paused", "pending", "error"]) {
      expect(neverSynced([binding({ status, last_synced_at: null })])).toHaveLength(0)
    }
  })
})

describe("erroredBindings", () => {
  it("finds one whose status says error", () => {
    expect(erroredBindings([binding({ id: "b1", status: "error" })])).toHaveLength(1)
  })

  it("finds one still marked active but carrying an error", () => {
    // The status and the error disagree; the error is the one that happened.
    expect(
      erroredBindings([binding({ id: "b1", last_error: "quota exceeded" })])
    ).toHaveLength(1)
  })

  it("is not fooled by an empty or whitespace error string", () => {
    // 🔴 `''` passes a plain `is not null` check — and so does `'  '`.
    expect(erroredBindings([binding({ last_error: "" })])).toHaveLength(0)
    expect(erroredBindings([binding({ last_error: "   " })])).toHaveLength(0)
  })

  it("stays quiet on a healthy binding", () => {
    expect(erroredBindings([binding()])).toHaveLength(0)
  })
})
