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

      // Step 8: Test ?handle= filter on collections (server-side)
      try {
        const handleRes: any = await api.get("/store/collections?handle=fallback-col", storeHeaders)
        console.log(`[step8] handle=fallback-col returned: ${handleRes.data.collections.length}`)

        expect(handleRes.data.collections.length).toBe(1)
        expect(handleRes.data.collections[0].handle).toBe("fallback-col")
      } catch (e: any) {
        console.log("[step8] handle filter failed:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }

      // Step 9: Test ?handle= filter returns empty for non-existent handle
      try {
        const noMatchRes: any = await api.get("/store/collections?handle=does-not-exist", storeHeaders)
        console.log(`[step9] handle=does-not-exist returned: ${noMatchRes.data.collections.length}`)

        expect(noMatchRes.data.collections.length).toBe(0)
      } catch (e: any) {
        console.log("[step9] no-match filter failed:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }

      // Step 10: Test ?handle= filter on categories (server-side)
      try {
        const catHandleRes: any = await api.get("/store/product-categories?handle=fallback-cat", storeHeaders)
        console.log(`[step10] handle=fallback-cat returned: ${catHandleRes.data.product_categories.length}`)

        expect(catHandleRes.data.product_categories.length).toBe(1)
        expect(catHandleRes.data.product_categories[0].handle).toBe("fallback-cat")
      } catch (e: any) {
        console.log("[step10] category handle filter failed:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }

      // Step 11: Test pagination response shape
      try {
        const pageRes: any = await api.get("/store/collections?limit=1&offset=0", storeHeaders)
        console.log(`[step11] Pagination: count=${pageRes.data.count}, offset=${pageRes.data.offset}, limit=${pageRes.data.limit}`)

        expect(pageRes.data).toHaveProperty("count")
        expect(pageRes.data).toHaveProperty("offset")
        expect(pageRes.data).toHaveProperty("limit")
        expect(pageRes.data.limit).toBe(1)
      } catch (e: any) {
        console.log("[step11] pagination failed:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }

      // Step 12: Create a second collection — test that both appear and limit works
      try {
        const col2Res: any = await api.post(
          "/admin/collections",
          { title: "Second Collection", handle: "second-col" },
          adminHeaders
        )
        const col2Id = col2Res.data.collection.id

        // Add a product to it in the same sales channel
        await api.post(
          "/admin/products",
          {
            title: "Second Product",
            collection_id: col2Id,
            status: "published",
            sales_channels: [{ id: salesChannelId }],
            options: [{ title: "Default", values: ["Default"] }],
            variants: [{ title: "Default", options: { Default: "Default" }, prices: [] }],
          },
          adminHeaders
        )

        const allRes: any = await api.get("/store/collections", storeHeaders)
        console.log(`[step12] All collections: ${allRes.data.collections.length}`,
          allRes.data.collections.map((c: any) => c.handle))

        expect(allRes.data.collections.length).toBe(2)

        // Test limit=1 only returns 1
        const limitRes: any = await api.get("/store/collections?limit=1", storeHeaders)
        console.log(`[step12] limit=1: ${limitRes.data.collections.length}, count=${limitRes.data.count}`)

        expect(limitRes.data.collections.length).toBe(1)
        expect(limitRes.data.count).toBe(2) // total count should still be 2
      } catch (e: any) {
        console.log("[step12] second collection test failed:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300))
        throw e
      }
    })

    it("should isolate partner store collections from main store collections", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      // ── Setup Main Store ──
      const scRes: any = await api.get("/admin/sales-channels?limit=1", adminHeaders)
      const mainScId = scRes.data.sales_channels[0].id

      const mainKeyRes: any = await api.post(
        "/admin/api-keys",
        { title: "main-store-pk", type: "publishable" },
        adminHeaders
      )
      const mainPk = mainKeyRes.data.api_key.token
      await api.post(
        `/admin/api-keys/${mainKeyRes.data.api_key.id}/sales-channels`,
        { add: [mainScId] },
        adminHeaders
      )

      // Create main store collection + product
      const mainColRes: any = await api.post(
        "/admin/collections",
        { title: "Main Latest", handle: "main-latest" },
        adminHeaders
      )
      const mainColId = mainColRes.data.collection.id

      await api.post(
        "/admin/products",
        {
          title: "Main Product",
          collection_id: mainColId,
          status: "published",
          sales_channels: [{ id: mainScId }],
          options: [{ title: "Default", values: ["Default"] }],
          variants: [{ title: "Default", options: { Default: "Default" }, prices: [] }],
        },
        adminHeaders
      )

      // ── Setup Partner Store ──
      // Create a separate sales channel for the partner
      const partnerScRes: any = await api.post(
        "/admin/sales-channels",
        { name: "Partner SC", is_disabled: false },
        adminHeaders
      )
      const partnerScId = partnerScRes.data.sales_channel.id

      const partnerKeyRes: any = await api.post(
        "/admin/api-keys",
        { title: "partner-store-pk", type: "publishable" },
        adminHeaders
      )
      const partnerPk = partnerKeyRes.data.api_key.token
      await api.post(
        `/admin/api-keys/${partnerKeyRes.data.api_key.id}/sales-channels`,
        { add: [partnerScId] },
        adminHeaders
      )

      // Create a store with this partner SC as default
      // (simulates what the partner storefront setup workflow does)
      const Modules = await import("@medusajs/framework/utils").then((m) => m.Modules)
      const storeModule = container.resolve(Modules.STORE) as any
      const partnerStore = await storeModule.createStores({
        name: "Partner Test Store",
        default_sales_channel_id: partnerScId,
        supported_currencies: [{ currency_code: "inr", is_default: true }],
      })
      console.log("[partner] Store created:", partnerStore.id)

      // Create partner collection
      const partnerColRes: any = await api.post(
        "/admin/collections",
        { title: "Partner Exclusive", handle: "partner-exclusive" },
        adminHeaders
      )
      const partnerColId = partnerColRes.data.collection.id

      // Link collection to partner store (this is what partner storefront creation does)
      const remoteLink = container.resolve("remoteLink") as any
      await remoteLink.create({
        [Modules.STORE]: { store_id: partnerStore.id },
        [Modules.PRODUCT]: { product_collection_id: partnerColId },
      })
      console.log("[partner] Collection linked to store")

      // Also create a product in the partner's sales channel with this collection
      await api.post(
        "/admin/products",
        {
          title: "Partner Product",
          collection_id: partnerColId,
          status: "published",
          sales_channels: [{ id: partnerScId }],
          options: [{ title: "Default", values: ["Default"] }],
          variants: [{ title: "Default", options: { Default: "Default" }, prices: [] }],
        },
        adminHeaders
      )

      // ── Verify Main Store sees only main collections ──
      const mainRes: any = await api.get("/store/collections", {
        headers: { "x-publishable-api-key": mainPk },
      })
      const mainHandles = mainRes.data.collections.map((c: any) => c.handle)
      console.log("[main store] Collections:", mainHandles)

      expect(mainHandles).toContain("main-latest")
      expect(mainHandles).not.toContain("partner-exclusive")

      // ── Verify Partner Store sees only partner collections ──
      const partnerRes: any = await api.get("/store/collections", {
        headers: { "x-publishable-api-key": partnerPk },
      })
      const partnerHandles = partnerRes.data.collections.map((c: any) => c.handle)
      console.log("[partner store] Collections:", partnerHandles)

      expect(partnerHandles).toContain("partner-exclusive")
      expect(partnerHandles).not.toContain("main-latest")

      // ── Verify handle filter is also scoped ──
      // Partner requesting main's handle should get nothing
      const crossRes: any = await api.get("/store/collections?handle=main-latest", {
        headers: { "x-publishable-api-key": partnerPk },
      })
      console.log("[partner store] handle=main-latest:", crossRes.data.collections.length)
      expect(crossRes.data.collections.length).toBe(0)

      // Main requesting partner's handle should get nothing
      const crossRes2: any = await api.get("/store/collections?handle=partner-exclusive", {
        headers: { "x-publishable-api-key": mainPk },
      })
      console.log("[main store] handle=partner-exclusive:", crossRes2.data.collections.length)
      expect(crossRes2.data.collections.length).toBe(0)
    })
  })
})

