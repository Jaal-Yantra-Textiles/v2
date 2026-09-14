import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { DESIGN_MODULE } from "../../src/modules/designs"
import designVariantLink from "../../src/links/design-variant-link"

jest.setTimeout(60 * 1000)

/**
 * #2057 — a design may back MANY variants.
 *
 * `design-variant-link` was `isList: false` on the variant side, so the SECOND
 * variant for a design threw at write time: a design with sizes S/M/L, or two
 * colourways, could not be represented at all.
 *
 * This has to be an integration test. `defineLink().entryPoint` is empty in a
 * unit test and the constraint being changed lives in the database, so a unit
 * test cannot tell a working one-to-many link from a broken one. The unit specs
 * cover what the READERS do with several variants; only this proves the link
 * can hold them.
 */
setupSharedTestSuite(() => {
  describe("A design can back many variants (#2057)", () => {
    let adminHeaders: any
    const { api, getContainer } = getSharedTestEnv()

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    const createDesign = async (label: string) => {
      const res = await api.post(
        "/admin/designs",
        {
          name: `ManyVariants ${label} ${Date.now()}`,
          description: "Design that backs several variants",
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    /** A product carrying two size variants, returned as their ids. */
    const createTwoVariants = async (label: string): Promise<string[]> => {
      const unique = Date.now()
      const res = await api
        .post(
          "/admin/products",
          {
            title: `ManyVariants Product ${label} ${unique}`,
            status: "published",
            options: [{ title: "Size", values: ["Small", "Medium"] }],
            variants: [
              {
                title: "Small",
                sku: `MV-${label}-S-${unique}`,
                options: { Size: "Small" },
                manage_inventory: true,
                prices: [{ amount: 1000, currency_code: "inr" }],
              },
              {
                title: "Medium",
                sku: `MV-${label}-M-${unique}`,
                options: { Size: "Medium" },
                manage_inventory: true,
                prices: [{ amount: 1200, currency_code: "inr" }],
              },
            ],
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      if (res.status !== 200) {
        throw new Error(`Create product failed ${res.status}: ${JSON.stringify(res.data)}`)
      }
      const ids = res.data.product.variants.map((v: any) => v.id)
      expect(ids).toHaveLength(2)
      return ids
    }

    it("links two variants to one design and reads both back", async () => {
      const designId = await createDesign("two")
      const [smallId, mediumId] = await createTwoVariants("two")

      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any

      // 🔴 Before #2057 the SECOND of these threw.
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.PRODUCT]: { product_variant_id: smallId },
      })
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.PRODUCT]: { product_variant_id: mediumId },
      })

      // Read through the link's own entryPoint — the only safe way to read a
      // link, and empty here would be indistinguishable from "never created".
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: rows } = await query.graph({
        entity: designVariantLink.entryPoint,
        filters: { design_id: designId },
        fields: ["design_id", "product_variant_id"],
      })

      const linkedVariantIds = (rows ?? []).map((r: any) => r.product_variant_id).sort()
      expect(linkedVariantIds).toEqual([smallId, mediumId].sort())
      expect(linkedVariantIds).toHaveLength(2)
    })

    /**
     * The design side stays `isList: false` — a variant is made from exactly
     * one design. Linking a second design to the same variant must still be
     * refused, or "which design produced this?" stops having an answer.
     */
    it("still refuses a second DESIGN for one variant", async () => {
      const designA = await createDesign("a")
      const designB = await createDesign("b")
      const [variantId] = await createTwoVariants("one-way")

      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designA },
        [Modules.PRODUCT]: { product_variant_id: variantId },
      })

      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
      await remoteLink
        .create({
          [DESIGN_MODULE]: { design_id: designB },
          [Modules.PRODUCT]: { product_variant_id: variantId },
        })
        .catch(() => {})

      const { data: rows } = await query.graph({
        entity: designVariantLink.entryPoint,
        filters: { product_variant_id: variantId },
        fields: ["design_id", "product_variant_id"],
      })

      // Whether the second write throws or overwrites, exactly one design must
      // own the variant afterwards — never two.
      expect(rows).toHaveLength(1)
    })
  })
})
