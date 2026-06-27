import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import {
  runGetCategories,
  runGetCategoryProducts,
  runGetProductDetails,
} from "../../src/mastra/agents/tools/storefront-catalog-tools"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("storefront chat catalog tools", () => {
    const { api, getContainer } = getSharedTestEnv()

    let adminHeaders: any

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("resolve seeded categories, category products, and product details", async () => {
      const container = getContainer()
      const storeService: any = container.resolve(Modules.STORE)
      const stores = await storeService.listStores({})
      const salesChannelId = stores?.[0]?.default_sales_channel_id

      const ts = Date.now()
      const catHandle = `chat-cat-${ts}`
      const prodHandle = `chat-prod-${ts}`

      const catRes = await api.post(
        "/admin/product-categories",
        { name: `Chat Cat ${ts}`, handle: catHandle, is_active: true, is_internal: false },
        adminHeaders
      )
      const categoryId = catRes.data.product_category.id

      const prodRes = await api.post(
        "/admin/products",
        {
          title: `Chat Product ${ts}`,
          handle: prodHandle,
          status: "published",
          sales_channels: salesChannelId ? [{ id: salesChannelId }] : undefined,
          categories: [{ id: categoryId }],
          options: [{ title: "Size", values: ["S", "M"] }],
          variants: [
            {
              title: "Small",
              options: { Size: "S" },
              prices: [{ amount: 2999, currency_code: "usd" }],
              manage_inventory: false,
            },
          ],
        },
        adminHeaders
      )
      const productId = prodRes.data.product.id

      // get_categories
      const cats = await runGetCategories(container)
      expect(cats.categories.some((c) => c.handle === catHandle)).toBe(true)

      // get_category_products (by handle)
      const inCat = await runGetCategoryProducts({ category: catHandle, limit: 5 }, container)
      expect(inCat.products.some((p) => p.id === productId)).toBe(true)
      // each hit carries attribution so the UI can render/link it
      expect(inCat.products[0].storefront).toBeTruthy()

      // get_category_products (by name)
      const byName = await runGetCategoryProducts({ category: `Chat Cat ${ts}` }, container)
      expect(byName.products.some((p) => p.id === productId)).toBe(true)

      // get_product_details
      const details = await runGetProductDetails({ handle: prodHandle }, container)
      expect(details.product?.handle).toBe(prodHandle)
      expect(details.product?.options?.[0]?.values).toEqual(
        expect.arrayContaining(["S", "M"])
      )
      expect(details.products.some((p) => p.id === productId)).toBe(true)
    })

    it("catalog tools degrade gracefully for unknown category/product", async () => {
      const container = getContainer()

      const inCat = await runGetCategoryProducts({ category: "no-such-category-xyz" }, container)
      expect(inCat.products).toEqual([])
      expect(inCat.error).toMatch(/no category/i)

      const details = await runGetProductDetails({ handle: "no-such-product-xyz" }, container)
      expect(details.products).toEqual([])
      expect(details.error).toMatch(/no published product/i)
    })
  })
})
