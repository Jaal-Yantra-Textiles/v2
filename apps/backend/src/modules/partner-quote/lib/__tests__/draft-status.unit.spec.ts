import { buildQuoteListQuery } from "../list-query"

/**
 * Drafts are a separate list, not a badge on the ordinary one (#1446).
 *
 * A draft is an unpriced quote. Mixed into the operator's default list it sits
 * beside quotes a buyer is holding, looking like one of them.
 */
describe("buildQuoteListQuery — drafts", () => {
  const now = new Date("2026-09-04T00:00:00Z")

  it("🔴 excludes drafts when no status is asked for", () => {
    const { filters } = buildQuoteListQuery({}, {}, now)
    expect(filters.status).toEqual({ $ne: "draft" })
  })

  it("shows drafts, and only drafts, when they are asked for", () => {
    const { filters } = buildQuoteListQuery({ status: "draft" }, {}, now)
    expect(filters.status).toBe("draft")
  })

  it("still narrows `active` by expiry, unchanged", () => {
    const { filters } = buildQuoteListQuery({ status: "active" }, {}, now)
    expect(filters.status).toBe("active")
    expect(filters.$and).toBeDefined()
  })

  /**
   * The pinned scope must survive the new default — a partner listing their
   * own quotes must not be widened by it.
   */
  it("keeps a caller-pinned partner scope alongside the draft exclusion", () => {
    const { filters } = buildQuoteListQuery({}, { partner_id: "par_1" }, now)
    expect(filters.partner_id).toBe("par_1")
    expect(filters.status).toEqual({ $ne: "draft" })
  })
})
