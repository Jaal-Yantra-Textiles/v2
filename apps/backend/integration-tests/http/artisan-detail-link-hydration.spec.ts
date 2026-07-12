import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { upsertArtisanProductDetailWorkflow } from "../../src/workflows/products/upsert-artisan-product-detail"
import { ARTISAN_PRODUCT_DETAIL_MODULE } from "../../src/modules/artisan-product-detail"

jest.setTimeout(60000)

// #859 — the storefront preview/PDP resolve the maker story through the
// product ↔ artisan_product_detail LINK, not the detail's `product_id` column.
// A detail row whose link never persisted (historically: the upsert workflow
// created the link only on first-create, and link-migration lag left the
// initial create's link unwritten) stayed readable by the module but invisible
// to query.graph, so the maker story silently vanished from the storefront.
// The workflow now ensures the link on EVERY upsert; these tests lock that in.
setupSharedTestSuite(() => {
  describe("artisan detail link hydration (#859)", () => {
    const { getContainer } = getSharedTestEnv()

    const makeProduct = async () => {
      const productService: any = getContainer().resolve(Modules.PRODUCT)
      const unique = Date.now() + Math.floor(Math.random() * 1000)
      const product = await productService.createProducts({
        title: `Artisan Link Test ${unique}`,
        status: "proposed",
      })
      return product.id as string
    }

    // The product-side alias is the linked MODEL name `artisan_product_detail`,
    // not `artisan_detail` — the exact mismatch that made the maker story never
    // hydrate on the storefront (#859).
    const graphDetail = async (productId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product",
        fields: [
          "id",
          "artisan_product_detail.id",
          "artisan_product_detail.maker_story",
        ],
        filters: { id: productId },
      })
      return (data[0] as any)?.artisan_product_detail
    }

    it("heals an orphan detail row (created without a link) on the next upsert", async () => {
      const container = getContainer()
      const productId = await makeProduct()

      // Reproduce the historical orphan: a detail row that exists (readable by
      // the module via product_id) but has NO product↔detail link.
      const service: any = container.resolve(ARTISAN_PRODUCT_DETAIL_MODULE)
      await service.createArtisanProductDetails({
        product_id: productId,
        made_to_order: true,
        maker_story: "Orphan story — set before the link existed.",
      })

      // Module can read it by column...
      expect(await service.findByProduct(productId)).toBeTruthy()
      // ...but query.graph (what the storefront uses) can't — no link.
      expect(await graphDetail(productId)).toBeFalsy()

      // The upsert takes the UPDATE branch (a row already exists) — the branch
      // that previously skipped linking. With the fix it must ensure the link.
      await upsertArtisanProductDetailWorkflow(container).run({
        input: {
          product_id: productId,
          data: { made_to_order: true, maker_story: "Healed story." },
        },
      })

      const healed = await graphDetail(productId)
      expect(healed?.id).toBeTruthy()
      expect(healed?.maker_story).toBe("Healed story.")
    })

    it("links on first-create so the maker story hydrates via query.graph", async () => {
      const container = getContainer()
      const productId = await makeProduct()

      await upsertArtisanProductDetailWorkflow(container).run({
        input: {
          product_id: productId,
          data: { made_to_order: true, maker_story: "Fresh maker story." },
        },
      })

      const detail = await graphDetail(productId)
      expect(detail?.id).toBeTruthy()
      expect(detail?.maker_story).toBe("Fresh maker story.")
    })
  })
})
