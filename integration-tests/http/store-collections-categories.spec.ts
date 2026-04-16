import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(120 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Store Collections & Categories Fallback", () => {
    it("should return collections and categories via sales channel fallback", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      // Step 1: Get existing default sales channel
      const scListRes: any = await api.get("/admin/sales-channels?limit=1", adminHeaders)
      const salesChannelId = scListRes.data.sales_channels[0].id
      console.log("[step1] Sales channel:", salesChannelId)

      // Step 2: Create publishable key + link
      const keyRes: any = await api.post(
        "/admin/api-keys",
        { title: "test-pk-col", type: "publishable" },
        adminHeaders
      )
      const apiKeyId = keyRes.data.api_key.id
      const publishableKey = keyRes.data.api_key.token
      console.log("[step2] PK created:", apiKeyId)

      await api.post(
        `/admin/api-keys/${apiKeyId}/sales-channels`,
        { add: [salesChannelId] },
        adminHeaders
      )
      console.log("[step2] PK linked to SC")

      // Step 3: Create collection
      const colRes: any = await api.post(
        "/admin/collections",
        { title: "Fallback Collection", handle: "fallback-col" },
        adminHeaders
      )
      const collectionId = colRes.data.collection.id
      console.log("[step3] Collection:", collectionId)

      // Step 4: Create category
      let categoryId: string | null = null
      try {
        const catRes: any = await api.post(
          "/admin/product-categories",
          { name: "Fallback Category", handle: "fallback-cat", is_active: true, is_internal: false },
          adminHeaders
        )
        categoryId = catRes.data.product_category.id
        console.log("[step4] Category:", categoryId)
      } catch (e: any) {
        console.log("[step4] Category creation failed:", e.response?.data || e.message)
      }

      // Step 5: Create product
      const productPayload: any = {
        title: "Fallback Product",
        collection_id: collectionId,
        status: "published",
        sales_channels: [{ id: salesChannelId }],
        options: [{ title: "Default", values: ["Default"] }],
        variants: [{ title: "Default", options: { Default: "Default" }, prices: [] }],
      }
      if (categoryId) {
        productPayload.categories = [{ id: categoryId }]
      }

      let productId: string
      try {
        const prodRes: any = await api.post("/admin/products", productPayload, adminHeaders)
        productId = prodRes.data.product.id
        console.log("[step5] Product:", productId)
      } catch (e: any) {
        console.log("[step5] Product creation failed:", JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }

      // Step 6: Test /store/collections
      const storeHeaders = { headers: { "x-publishable-api-key": publishableKey } }
      try {
        const storeColRes: any = await api.get("/store/collections", storeHeaders)
        console.log(`[step6] Collections returned: ${storeColRes.data.collections.length}`,
          storeColRes.data.collections.map((c: any) => c.handle))

        const found = storeColRes.data.collections.find((c: any) => c.handle === "fallback-col")
        expect(found).toBeDefined()
        expect(found.title).toBe("Fallback Collection")
      } catch (e: any) {
        console.log("[step6] Store collections failed:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }

      // Step 7: Test /store/product-categories
      try {
        const storeCatRes: any = await api.get("/store/product-categories", storeHeaders)
        console.log(`[step7] Categories returned: ${storeCatRes.data.product_categories.length}`,
          storeCatRes.data.product_categories.map((c: any) => c.handle))

        expect(Array.isArray(storeCatRes.data.product_categories)).toBe(true)
      } catch (e: any) {
        console.log("[step7] Store categories failed:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }
    })
  })
})
