import {
  checkPreferenceWritable,
  isPreferenceInScope,
  type PricePreferenceScope,
} from "../price-preferences/lib/scope"
import { missingOwnedIds } from "../helpers"

/**
 * Partner scoping for the one pricing surface with no partner dimension.
 *
 * `/partners/price-preferences` listed EVERY preference on the platform — the
 * query carried no filters — and created, updated and deleted them with no
 * ownership check beyond "are you a partner". The same routes are exposed to
 * the partner AI assistant as `write: true` MCP tools.
 */

const scope = (over: Partial<PricePreferenceScope> = {}): PricePreferenceScope => ({
  region_ids: ["reg_mine", "reg_shared"],
  exclusive_region_ids: ["reg_mine"],
  currency_codes: ["inr", "eur"],
  ...over,
})

describe("isPreferenceInScope", () => {
  it("shows a region preference for one of the partner's regions", () => {
    expect(isPreferenceInScope({ attribute: "region_id", value: "reg_mine" }, scope())).toBe(true)
  })

  it("shows a SHARED region's preference — reading is wider than writing", () => {
    // A preference that governs this partner's prices is theirs to see even
    // when it is not theirs to change.
    expect(isPreferenceInScope({ attribute: "region_id", value: "reg_shared" }, scope())).toBe(true)
  })

  it("hides another partner's region", () => {
    expect(isPreferenceInScope({ attribute: "region_id", value: "reg_theirs" }, scope())).toBe(false)
  })

  it("shows a currency the partner's store supports, case-insensitively", () => {
    expect(isPreferenceInScope({ attribute: "currency_code", value: "INR" }, scope())).toBe(true)
  })

  it("hides a currency the partner's store does not support", () => {
    expect(isPreferenceInScope({ attribute: "currency_code", value: "usd" }, scope())).toBe(false)
  })

  it("hides an attribute we do not model, rather than defaulting to visible", () => {
    expect(isPreferenceInScope({ attribute: "customer_group_id", value: "x" }, scope())).toBe(false)
    expect(isPreferenceInScope({}, scope())).toBe(false)
  })

  it("shows nothing to a partner with no regions and no store", () => {
    const empty = scope({ region_ids: [], exclusive_region_ids: [], currency_codes: [] })
    expect(isPreferenceInScope({ attribute: "region_id", value: "reg_mine" }, empty)).toBe(false)
    expect(isPreferenceInScope({ attribute: "currency_code", value: "inr" }, empty)).toBe(false)
  })
})

describe("checkPreferenceWritable", () => {
  it("allows a region that belongs to this partner alone", () => {
    expect(checkPreferenceWritable({ attribute: "region_id", value: "reg_mine" }, scope())).toEqual({
      writable: true,
      reason: null,
    })
  })

  it("REFUSES a shared region, and says it is shared", () => {
    // On prod one region backs ~10 stores, so "linked to me" is not "mine".
    const res = checkPreferenceWritable({ attribute: "region_id", value: "reg_shared" }, scope())
    expect(res.writable).toBe(false)
    expect(res.reason).toMatch(/shared with other partners/i)
  })

  it("refuses a region that is not the partner's at all, with a different reason", () => {
    const res = checkPreferenceWritable({ attribute: "region_id", value: "reg_theirs" }, scope())
    expect(res.writable).toBe(false)
    expect(res.reason).toMatch(/not one of yours/i)
  })

  it("ALWAYS refuses a currency preference, even a supported one", () => {
    // Platform-wide by construction: flipping tax-inclusivity for INR changes
    // it for every store pricing in INR. There is no version of this write
    // that is "yours".
    const res = checkPreferenceWritable({ attribute: "currency_code", value: "inr" }, scope())
    expect(res.writable).toBe(false)
    expect(res.reason).toMatch(/every store pricing in inr/i)
  })

  it("refuses an unknown attribute", () => {
    const res = checkPreferenceWritable({ attribute: "nonsense", value: "x" }, scope())
    expect(res.writable).toBe(false)
    expect(res.reason).toMatch(/unsupported/i)
  })

  it("never returns writable without also returning a null reason", () => {
    for (const value of ["reg_mine", "reg_shared", "reg_theirs"]) {
      const res = checkPreferenceWritable({ attribute: "region_id", value }, scope())
      expect(res.writable).toBe(res.reason === null)
    }
  })
})

/**
 * The "both ends" primitive. Two partner routes validated the id in the URL and
 * ignored the ids in the body — one let a partner pull another partner's
 * customers into their own group, the other let them push their own customer
 * into someone else's group. The second matters most: once a customer group
 * carries a negotiated B2B price list, that customer inherits pricing that was
 * never theirs.
 */
describe("missingOwnedIds", () => {
  it("returns nothing when every id is owned", () => {
    expect(missingOwnedIds(["a", "b"], ["a"])).toEqual([])
    expect(missingOwnedIds(["a", "b"], ["a", "b"])).toEqual([])
  })

  it("names exactly the ids that are not owned", () => {
    expect(missingOwnedIds(["a"], ["a", "b", "c"])).toEqual(["b", "c"])
  })

  it("dedupes a repeated foreign id", () => {
    expect(missingOwnedIds(["a"], ["b", "b"])).toEqual(["b"])
  })

  it("ignores empty entries on both sides rather than reporting them missing", () => {
    expect(missingOwnedIds(["a", null, undefined], ["a", "", null as any])).toEqual([])
  })

  it("treats an empty owned set as owning nothing, not everything", () => {
    // The dangerous default. A partner with no customers must not pass a check
    // simply because the comparison set came back empty.
    expect(missingOwnedIds([], ["a"])).toEqual(["a"])
  })
})
