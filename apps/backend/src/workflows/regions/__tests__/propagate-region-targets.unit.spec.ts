import { selectPropagationTargets } from "../propagate-region-to-partners"

/**
 * A partner's own region must not be handed to every other partner.
 *
 * 🔴 `propagate-region-to-partners` is reached from two directions —
 * `region.created` (share a new region with every partner) and `partner.created`
 * (give a new partner every existing region, #2062) — and neither asked WHOSE
 * region it was. `POST /partners/stores/:id/regions` lets a partner create one
 * and stamps `metadata.created_by_partner_id` precisely so partner-made can be
 * told from admin-seeded; nothing read it. So a region a partner made for their
 * own store was linked to every partner who signed up afterwards, and
 * `partner-stores-api.spec.ts`'s tenancy test has been red on main saying so.
 */
describe("selectPropagationTargets", () => {
  const partners = [{ id: "p1" }, { id: "p2" }, { id: "p3" }]

  it("shares an ADMIN-seeded region with every partner — #2062's purpose", () => {
    expect(selectPropagationTargets(partners, {})).toEqual(partners)
  })

  it("keeps a PARTNER-created region with its creator alone", () => {
    expect(
      selectPropagationTargets(partners, { ownerPartnerId: "p2" })
    ).toEqual([{ id: "p2" }])
  })

  /**
   * The `partner.created` direction: a NEW partner asks for every region, and
   * must not collect other tenants' regions on the way.
   */
  it("gives a newly created partner nothing of another tenant's", () => {
    expect(
      selectPropagationTargets(partners, {
        requestedPartnerIds: ["p3"],
        ownerPartnerId: "p1",
      })
    ).toEqual([])
  })

  it("still reaches a scoped partner when the region is the platform's", () => {
    expect(
      selectPropagationTargets(partners, { requestedPartnerIds: ["p3"] })
    ).toEqual([{ id: "p3" }])
  })

  /**
   * 🔑 An empty or whitespace stamp is ABSENT, not "owned by nobody in
   * particular" — a blank string must read as admin-seeded, or a half-written
   * metadata row would quietly strand a platform region with no targets at all.
   */
  it("treats a blank stamp as admin-seeded", () => {
    expect(selectPropagationTargets(partners, { ownerPartnerId: "   " })).toEqual(
      partners
    )
    expect(selectPropagationTargets(partners, { ownerPartnerId: null })).toEqual(
      partners
    )
  })

  it("survives a missing partner list", () => {
    expect(selectPropagationTargets(null, { ownerPartnerId: "p1" })).toEqual([])
  })
})
