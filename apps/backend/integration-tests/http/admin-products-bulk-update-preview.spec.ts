import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(90 * 1000)

/**
 * `preview` must reach the route and must NOT write (#1877).
 *
 * This is an HTTP test on purpose. The MCP dispatcher consumes `dry_run`
 * itself and answers with a planned request without ever calling this route, so
 * the tool's advertised rehearsal could never surface the real per-row plan —
 * and a unit test on the registry row proves the tool's SHAPE, not that the
 * flag arrives. The only thing that settles it is posting each flag
 * combination and reading back the variant.
 *
 * The apply-by-default case is tested as carefully as the preview case: this
 * route has been apply-by-default since it shipped, and a default flipped to
 * preview would turn every existing caller's write into a silent no-op that
 * looks exactly like success.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /admin/products/bulk-update — preview vs apply", () => {
    let adminHeaders: Record<string, any>

    const createProduct = async (weight: number | null) => {
      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const res = await api.post(
        "/admin/products",
        {
          title: `Bulk Preview ${unique}`,
          status: "draft",
          options: [{ title: "Size", values: ["S"] }],
          variants: [
            {
              title: "S",
              options: { Size: "S" },
              ...(weight === null ? {} : { weight }),
              prices: [{ currency_code: "usd", amount: 10 }],
            },
          ],
        },
        adminHeaders
      )
      const product = res.data.product
      return { product_id: product.id, variant_id: product.variants[0].id }
    }

    const readWeight = async (productId: string, variantId: string) => {
      const res = await api.get(`/admin/products/${productId}`, adminHeaders)
      return res.data.product.variants.find((v: any) => v.id === variantId)?.weight
    }

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("preview:true returns the per-row plan and writes NOTHING", async () => {
      const { product_id, variant_id } = await createProduct(100)

      const res = await api.post(
        "/admin/products/bulk-update",
        {
          preview: true,
          products: [
            { product_id, variants: [{ variant_id, update: { weight: 999 } }] },
          ],
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      // The route's OWN change set — the thing the dispatcher's plan echo could
      // never produce. It names the variant it would touch.
      expect(res.data.dry_run).toBe(true)
      expect(res.data.variants.map((v: any) => v.variant_id)).toContain(variant_id)

      // The only assertion that actually proves "no write".
      expect(await readWeight(product_id, variant_id)).toBe(100)
    })

    it("omitting both flags APPLIES — the default every existing caller relies on", async () => {
      const { product_id, variant_id } = await createProduct(100)

      const res = await api.post(
        "/admin/products/bulk-update",
        {
          products: [
            { product_id, variants: [{ variant_id, update: { weight: 777 } }] },
          ],
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.dry_run).toBe(false)
      expect(await readWeight(product_id, variant_id)).toBe(777)
    })

    it("preview:false applies, and is not swallowed by dry_run's default", async () => {
      const { product_id, variant_id } = await createProduct(100)

      await api.post(
        "/admin/products/bulk-update",
        {
          preview: false,
          products: [
            { product_id, variants: [{ variant_id, update: { weight: 555 } }] },
          ],
        },
        adminHeaders
      )

      expect(await readWeight(product_id, variant_id)).toBe(555)
    })

    it("dry_run:true still fails safe for a direct HTTP caller", async () => {
      const { product_id, variant_id } = await createProduct(100)

      await api.post(
        "/admin/products/bulk-update",
        {
          dry_run: true,
          products: [
            { product_id, variants: [{ variant_id, update: { weight: 999 } }] },
          ],
        },
        adminHeaders
      )

      expect(await readWeight(product_id, variant_id)).toBe(100)
    })

    it("takes the SAFE reading when the two spellings contradict", async () => {
      const { product_id, variant_id } = await createProduct(100)

      await api.post(
        "/admin/products/bulk-update",
        {
          preview: false,
          dry_run: true,
          products: [
            { product_id, variants: [{ variant_id, update: { weight: 999 } }] },
          ],
        },
        adminHeaders
      )

      expect(await readWeight(product_id, variant_id)).toBe(100)
    })
  })
})
