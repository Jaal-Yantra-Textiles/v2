/**
 * Admin designs list filtered by partner: the total is exact and every
 * linked design can be reached.
 *
 * 🔴 The filter used the index engine, whose result has no `count`; the
 * route fell back to the page length, so the admin list asked for 20, was
 * told 20 existed and never offered page 2 (prod: Sharlho, 49 linked, 20 shown).
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/admin-designs-partner-filter
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { DESIGN_MODULE } from "../../src/modules/designs"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("GET /admin/designs?partner_id=", () => {
    let headers: Record<string, any>
    let partnerId: string
    const u = Date.now().toString(36)

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      const partners: any = container.resolve(PARTNER_MODULE)
      const designs: any = container.resolve(DESIGN_MODULE)
      const link: any = container.resolve(ContainerRegistrationKeys.LINK)

      const p = await partners.createPartners({ name: `Filter ${u}`, handle: `filter-${u}` })
      partnerId = p.id

      // 25 linked designs (one named "Velvet"), plus one that is not linked.
      const linked = await designs.createDesigns(
        Array.from({ length: 25 }, (_, i) => ({ name: i === 7 ? `Velvet coat ${u}` : `Linked ${i} ${u}`, description: "x" }))
      )
      await designs.createDesigns({ name: `Unlinked ${u}`, description: "x" })
      await link.create(
        linked.map((d: any) => ({
          [DESIGN_MODULE]: { design_id: d.id },
          [PARTNER_MODULE]: { partner_id: partnerId },
        }))
      )
    })

    it("reports the real total and pages through every linked design", async () => {
      const page1 = await api.get(`/admin/designs?partner_id=${partnerId}&limit=20&offset=0`, headers)
      expect(page1.status).toBe(200)
      expect(page1.data.count).toBe(25)
      expect(page1.data.designs).toHaveLength(20)
      expect(page1.data.designs.every((d: any) => d.partners.some((p: any) => p.id === partnerId))).toBe(true)

      const page2 = await api.get(`/admin/designs?partner_id=${partnerId}&limit=20&offset=20`, headers)
      expect(page2.data.count).toBe(25)
      expect(page2.data.designs).toHaveLength(5)

      const all = new Set([...page1.data.designs, ...page2.data.designs].map((d: any) => d.id))
      expect(all.size).toBe(25)
      expect([...page1.data.designs, ...page2.data.designs].some((d: any) => d.name.startsWith("Unlinked"))).toBe(false)
    })

    it("combines the partner filter with a name search", async () => {
      const res = await api.get(`/admin/designs?partner_id=${partnerId}&name=velvet&limit=20`, headers)
      expect(res.data.count).toBe(1)
      expect(res.data.designs[0].name).toBe(`Velvet coat ${u}`)
    })

    it("returns nothing for a partner with no designs", async () => {
      const other = await getContainer().resolve<any>(PARTNER_MODULE).createPartners({ name: `Empty ${u}`, handle: `empty-${u}` })
      const res = await api.get(`/admin/designs?partner_id=${other.id}&limit=20`, headers)
      expect(res.data.count).toBe(0)
      expect(res.data.designs).toEqual([])
    })
  })
})
