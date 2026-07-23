import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import {
  runGetCategories,
  runGetCategoryProducts,
  runGetProductDetails,
} from "../../src/mastra/agents/tools/storefront-catalog-tools"
import { PERSON_MODULE } from "../../src/modules/person"
import {
  runCaptureContact,
  STOREFRONT_CHAT_LEAD_SOURCE,
} from "../../src/mastra/agents/tools/storefront-capture-contact"

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

    it("capture_contact creates a lead person tagged with the storefront_chat source", async () => {
      const container = getContainer()
      const personService: any = container.resolve(PERSON_MODULE)
      const email = `chat-lead-${Date.now()}@example.com`

      const res = await runCaptureContact(
        { email, name: "Asha Rao", interest: "indigo cotton kurta" },
        container,
        "visitor-abc"
      )
      expect(res).toEqual({ saved: true, already_known: false })

      const [person] = await personService.listPeople({ email })
      expect(person).toBeTruthy()
      expect(person.first_name).toBe("Asha")
      expect(person.last_name).toBe("Rao")
      expect(person.metadata?.source).toBe(STOREFRONT_CHAT_LEAD_SOURCE)
      expect(person.metadata?.visitor_id).toBe("visitor-abc")
      expect(person.metadata?.interest).toBe("indigo cotton kurta")
    })

    it("capture_contact is idempotent per email and never overwrites an existing source", async () => {
      const container = getContainer()
      const personService: any = container.resolve(PERSON_MODULE)
      const email = `chat-existing-${Date.now()}@example.com`

      // A person already acquired via another surface, with no name yet.
      const seeded = await personService.createPeople({
        first_name: "",
        last_name: "",
        email,
        metadata: { source: "ad_planning_order_placed" },
      })

      const res = await runCaptureContact(
        { email: email.toUpperCase(), name: "Meera Iyer" },
        container
      )
      expect(res).toEqual({ saved: true, already_known: true })

      const people = await personService.listPeople({ email })
      // Still one row (dedup on the unique email, case-insensitive input).
      expect(people).toHaveLength(1)
      expect(people[0].id).toBe(seeded.id)
      // Missing name enriched…
      expect(people[0].first_name).toBe("Meera")
      // …but the original acquisition source is preserved, not relabelled.
      expect(people[0].metadata?.source).toBe("ad_planning_order_placed")
    })
  })
})
