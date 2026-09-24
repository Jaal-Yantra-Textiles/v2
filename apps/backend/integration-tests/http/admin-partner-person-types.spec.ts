/**
 * Admin API — a person type is shared by many partners.
 *
 * The partner ↔ person_type link was one-to-many from the person type's side:
 * "Model" could belong to ONE partner, so tagging a second model answered 400
 * "Cannot create multiple links between 'partner' and 'person_type'" (found on
 * prod 2026-09-24 tagging Sunny after Sonam). Every type is a category —
 * Tailor, Weaver, Designer — and must link to any number of partners.
 */
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(120 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin Partners API — person types", () => {
    let headers: { headers: Record<string, string> }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
    })

    it("tags two partners with the same person type", async () => {
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const partners = container().resolve(PARTNER_MODULE) as any
      const [a, b] = await Promise.all(
        ["a", "b"].map((s) => partners.createPartners({ name: `Model ${s} ${unique}`, handle: `model-${s}-${unique}` }))
      )
      const type = (await api.post("/admin/persontypes", { name: `Model ${unique}`, description: "People who get photographed" }, headers))
        .data.personType

      const tag = (id: string) =>
        api.post(`/admin/partners/${id}/person-types`, { person_type_ids: [type.id] }, { ...headers, validateStatus: () => true })
      const first = await tag(a.id)
      expect([first.status, first.data?.message]).toEqual([200, undefined])
      const second = await tag(b.id)
      expect([second.status, second.data?.message]).toEqual([200, undefined])

      for (const p of [a, b]) {
        const got = await api.get(`/admin/partners/${p.id}/person-types`, headers)
        expect(got.data.person_types.map((t: any) => t.id)).toEqual([type.id])
      }
    })

    function container() {
      return getContainer()
    }
  })
})
