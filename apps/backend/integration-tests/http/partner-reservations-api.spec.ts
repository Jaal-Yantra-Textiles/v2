import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithInventory(
  api: any,
  adminHeaders: Record<string, any>,
  getContainer: () => any
) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-res-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `ResTest ${unique}`,
      handle: `restest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Res" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `ResStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `ResChannel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  const storeId = storeRes.data.store.id
  const locationId = storeRes.data.location?.id

  const productRes = await api.post(
    `/partners/stores/${storeId}/products`,
    {
      title: `Res Product ${unique}`,
      handle: `res-prod-${unique}`,
      status: ProductStatus.PUBLISHED,
      options: [{ title: "Size", values: ["S"] }],
      variants: [
        {
          title: "Small",
          sku: `RES-S-${unique}`,
          manage_inventory: true,
          options: { Size: "S" },
          prices: [{ amount: 1000, currency_code: currencyCode }],
        },
      ],
    },
    { headers }
  )

  const product = productRes.data.product
  const variantId = product?.variants?.[0]?.id

  let inventoryItemId: string | null = null
  if (variantId) {
    const container = getContainer()
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: products } = await query.graph({
      entity: "products",
      fields: ["variants.inventory_items.inventory.id"],
      filters: { id: product.id },
    })
    const items = products?.[0]?.variants?.[0]?.inventory_items || []
    inventoryItemId = items[0]?.inventory?.id || null

    // Add initial stock so reservations can be created
    if (inventoryItemId && locationId) {
      const inventoryService = container.resolve(Modules.INVENTORY) as any
      try {
        await inventoryService.adjustInventory(inventoryItemId, locationId, 100)
      } catch {
        // Level might not exist yet or adjustment failed — non-fatal
      }
    }
  }

  return {
    headers,
    partnerId,
    storeId,
    locationId,
    currencyCode,
    productId: product?.id,
    variantId,
    inventoryItemId,
  }
}

setupSharedTestSuite(() => {
  describe("Partner API - Reservations", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithInventory>>

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithInventory(api, adminHeaders, getContainer)
    })

    describe("GET /partners/reservations", () => {
      it("should list reservations (initially empty)", async () => {
        const { api } = getSharedTestEnv()
        const res = await api.get("/partners/reservations", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.reservations)).toBe(true)
        expect(res.data.reservations.length).toBe(0)
        expect(res.data.count).toBe(0)
      })

      it("should filter by inventory_item_id", async () => {
        const { api } = getSharedTestEnv()
        const res = await api.get(
          `/partners/reservations?inventory_item_id=${partner.inventoryItemId}`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.reservations)).toBe(true)
      })

      it("should return 401 without auth", async () => {
        const { api } = getSharedTestEnv()
        const res = await api
          .get("/partners/reservations")
          .catch((err: any) => err.response)
        expect([400, 401]).toContain(res.status)
      })
    })

    describe("POST /partners/reservations", () => {
      it("should create a reservation at partner location", async () => {
        const { api } = getSharedTestEnv()
        if (!partner.inventoryItemId || !partner.locationId) {
          console.log("[skip] No inventory item or location")
          return
        }

        const res = await api.post(
          "/partners/reservations",
          {
            inventory_item_id: partner.inventoryItemId,
            location_id: partner.locationId,
            quantity: 5,
            description: "Test reservation",
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.reservation).toBeDefined()
        expect(res.data.reservation.quantity).toBe(5)
        expect(res.data.reservation.inventory_item_id).toBe(partner.inventoryItemId)
        expect(res.data.reservation.location_id).toBe(partner.locationId)
      })

      it("should reject reservation at a non-partner location", async () => {
        const { api } = getSharedTestEnv()
        if (!partner.inventoryItemId) return

        const res = await api.post(
          "/partners/reservations",
          {
            inventory_item_id: partner.inventoryItemId,
            location_id: "sloc_fake_not_partner",
            quantity: 5,
          },
          {
            headers: partner.headers,
            validateStatus: () => true,
          }
        )
        expect([400, 404]).toContain(res.status)
      })

      it("should reject without required fields", async () => {
        const { api } = getSharedTestEnv()
        const res = await api.post(
          "/partners/reservations",
          { inventory_item_id: partner.inventoryItemId },
          {
            headers: partner.headers,
            validateStatus: () => true,
          }
        )
        expect([400, 500]).toContain(res.status)
      })
    })

    describe("Reservation CRUD lifecycle", () => {
      it("should create, read, update, and delete a reservation", async () => {
        const { api } = getSharedTestEnv()
        if (!partner.inventoryItemId || !partner.locationId) {
          console.log("[skip] No inventory item or location")
          return
        }

        // Create
        const createRes = await api.post(
          "/partners/reservations",
          {
            inventory_item_id: partner.inventoryItemId,
            location_id: partner.locationId,
            quantity: 3,
            description: "Lifecycle test",
          },
          { headers: partner.headers }
        )
        expect(createRes.status).toBe(201)
        const reservationId = createRes.data.reservation.id
        expect(reservationId).toBeDefined()

        // Read
        const getRes = await api.get(
          `/partners/reservations/${reservationId}`,
          { headers: partner.headers }
        )
        expect(getRes.status).toBe(200)
        expect(getRes.data.reservation.id).toBe(reservationId)
        expect(getRes.data.reservation.quantity).toBe(3)

        // Update
        const updateRes = await api.post(
          `/partners/reservations/${reservationId}`,
          { quantity: 7, description: "Updated" },
          { headers: partner.headers }
        )
        expect(updateRes.status).toBe(200)
        expect(updateRes.data.reservation.quantity).toBe(7)

        // List — should include the reservation
        const listRes = await api.get(
          `/partners/reservations?inventory_item_id=${partner.inventoryItemId}`,
          { headers: partner.headers }
        )
        expect(listRes.status).toBe(200)
        expect(listRes.data.reservations.length).toBeGreaterThanOrEqual(1)
        expect(
          listRes.data.reservations.some((r: any) => r.id === reservationId)
        ).toBe(true)

        // Delete
        const deleteRes = await api.delete(
          `/partners/reservations/${reservationId}`,
          { headers: partner.headers }
        )
        expect(deleteRes.status).toBe(200)
        expect(deleteRes.data.deleted).toBe(true)

        // Verify gone
        const afterRes = await api.get(
          `/partners/reservations/${reservationId}`,
          {
            headers: partner.headers,
            validateStatus: () => true,
          }
        )
        expect([400, 404, 500]).toContain(afterRes.status)
      })
    })

    describe("Cross-partner isolation", () => {
      it("partner cannot access another partner's reservation", async () => {
        const { api, getContainer } = getSharedTestEnv()
        if (!partner.inventoryItemId || !partner.locationId) return

        // Create reservation as partner 1
        const createRes = await api.post(
          "/partners/reservations",
          {
            inventory_item_id: partner.inventoryItemId,
            location_id: partner.locationId,
            quantity: 2,
          },
          { headers: partner.headers }
        )
        expect(createRes.status).toBe(201)
        const reservationId = createRes.data.reservation.id

        // Create partner 2
        const partner2 = await createPartnerWithInventory(api, adminHeaders, getContainer)

        // Partner 2 tries to read partner 1's reservation
        const res = await api.get(
          `/partners/reservations/${reservationId}`,
          {
            headers: partner2.headers,
            validateStatus: () => true,
          }
        )
        expect([400, 404]).toContain(res.status)
      })
    })

    describe("Product inventory auto-link", () => {
      it("should auto-create inventory level at partner location", async () => {
        if (!partner.inventoryItemId || !partner.locationId) {
          console.log("[skip] No inventory item or location")
          return
        }

        const { getContainer } = getSharedTestEnv()
        const container = getContainer()
        const inventoryService = container.resolve(Modules.INVENTORY) as any
        const levels = await inventoryService.listInventoryLevels({
          inventory_item_id: partner.inventoryItemId,
          location_id: partner.locationId,
        })

        expect(levels.length).toBeGreaterThanOrEqual(1)
        expect(levels[0].inventory_item_id).toBe(partner.inventoryItemId)
        expect(levels[0].location_id).toBe(partner.locationId)
      })
    })
  })
})
