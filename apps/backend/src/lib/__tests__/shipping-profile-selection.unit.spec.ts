/**
 * The profile pick must be DETERMINISTIC once a second profile exists (#1983).
 *
 * Store provisioning read `listShippingProfiles({}, { take: 1 })` and fed the
 * answer to all ten of a new store's shipping options. That is correct by
 * accident while exactly one profile exists — which is exactly the state prod
 * is in, and exactly why nobody noticed. The tests below are written against
 * the two-profile world #1983 is about to create.
 */
import {
  describeAmbiguousProfilePick,
  pickTargetProfileId,
} from "../shipping-profile-selection"

const DEFAULT = { id: "sp_default", type: "default", name: "Default Shipping Profile" }
const PARTNER = { id: "sp_partner", type: "custom", name: "Partner Shipping Profile" }

describe("pickTargetProfileId", () => {
  it("picks the type:'default' profile when a partner profile also exists", () => {
    // The regression in one line: with `take: 1` this answer depended on row
    // order, so half the stores would have been provisioned onto sp_partner.
    expect(pickTargetProfileId([DEFAULT, PARTNER])).toBe("sp_default")
  })

  it("gives the SAME answer whatever order the rows arrive in", () => {
    // `take: 1` would return a different id for these two inputs. That is the
    // whole defect, stated as a property rather than a case.
    expect(pickTargetProfileId([DEFAULT, PARTNER])).toBe(
      pickTargetProfileId([PARTNER, DEFAULT])
    )
  })

  it("falls back to the only profile when nothing is marked default", () => {
    expect(pickTargetProfileId([PARTNER])).toBe("sp_partner")
  })

  it("returns null rather than guessing between two non-default profiles", () => {
    const other = { id: "sp_other", type: "custom" }
    expect(pickTargetProfileId([PARTNER, other])).toBeNull()
  })

  it("returns null rather than guessing between two DEFAULT profiles", () => {
    // A second row typed "default" is a data problem. Picking one would bury
    // it; null makes the caller say so.
    expect(pickTargetProfileId([DEFAULT, { id: "sp_dupe", type: "default" }])).toBeNull()
  })

  it("returns null on an empty list — 'none' is a separate case from 'ambiguous'", () => {
    // The caller distinguishes them: none → create the default; ambiguous →
    // refuse. Collapsing the two is how a third profile would get minted into
    // an already-ambiguous database.
    expect(pickTargetProfileId([])).toBeNull()
  })

  it("honours an explicit id that exists", () => {
    expect(pickTargetProfileId([DEFAULT, PARTNER], "sp_partner")).toBe("sp_partner")
  })

  it("refuses an explicit id that does NOT exist, rather than falling back", () => {
    // Falling back to the default here would silently ship the caller's
    // products on a profile they did not ask for.
    expect(pickTargetProfileId([DEFAULT], "sp_ghost")).toBeNull()
  })

  it("tolerates malformed rows without throwing", () => {
    expect(pickTargetProfileId([null as any, undefined as any, DEFAULT])).toBe(
      "sp_default"
    )
  })
})

describe("describeAmbiguousProfilePick", () => {
  it("names the missing profile when an explicit id was given", () => {
    expect(describeAmbiguousProfilePick([DEFAULT], "sp_ghost")).toContain("sp_ghost")
  })

  it("counts what it found so the operator can act on the message alone", () => {
    const msg = describeAmbiguousProfilePick([PARTNER, { id: "sp_other", type: "custom" }])
    expect(msg).toContain("2 profile(s)")
    expect(msg).toContain('0 of type "default"')
  })
})
