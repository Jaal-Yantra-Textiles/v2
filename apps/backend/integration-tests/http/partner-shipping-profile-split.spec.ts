import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { resolveHouseSalesChannelId } from "../../src/lib/partner-shipping-profile"
import { PARTNER_SHIPPING_PROFILE_NAME } from "../../src/lib/shipping-profile-selection"

const TEST_PARTNER_PASSWORD = "supersecret"
const RUN = "/admin/ops/maintenance-jobs/split-partner-shipping-profile/run"

jest.setTimeout(120 * 1000)

/**
 * #1983 — partner shipping on its own profile, STRICT split (founder,
 * 2026-09-23): a house option ships house products only, a partner option ships
 * partner products only. Medusa enforces it through profile equality at
 * checkout and fulfillment, so every assertion here is about which profile a
 * STORED row carries — read back from the database, never taken from a create
 * response.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  // A bare "status code 500" names nothing. Put the server's answer in the
  // failure message so a red run says WHY.
  beforeAll(() => {
    if ((api as any).__splitSpecErrors) return
    api.interceptors.response.use(undefined, (e: any) => {
      const body = e?.response?.data ? JSON.stringify(e.response.data) : ""
      e.message = `${e.config?.method?.toUpperCase()} ${e.config?.url} -> ${e?.response?.status} ${body}`
      return Promise.reject(e)
    })
    ;(api as any).__splitSpecErrors = true
  })

  describe("#1983 partner shipping profile split", () => {
    let adminHeaders: Record<string, any>
    let partnerHeaders: Record<string, string>
    let storeId: string
    let locationId: string
    let houseProfileId: string

    const profileOfOption = async (optionId: string) => {
      const res = await api.get(`/admin/shipping-options/${optionId}`, adminHeaders)
      return res.data.shipping_option.shipping_profile_id as string
    }
    const profileOfProduct = async (productId: string) => {
      const res = await api.get(
        `/admin/products/${productId}?fields=id,shipping_profile.id`,
        adminHeaders
      )
      return (res.data.product.shipping_profile?.id ?? null) as string | null
    }
    const partnerProfileId = async () => {
      const res = await api.get("/admin/shipping-profiles", adminHeaders)
      const matches = (res.data.shipping_profiles || []).filter(
        (p: any) => p.name === PARTNER_SHIPPING_PROFILE_NAME && p.type === "custom"
      )
      expect(matches).toHaveLength(1)
      return matches[0].id as string
    }
    const storeOptionIds = async () => {
      const zonesRes = await api.get(
        `/admin/stock-locations/${locationId}?fields=*fulfillment_sets,fulfillment_sets.service_zones.id`,
        adminHeaders
      )
      const zoneIds = (zonesRes.data.stock_location?.fulfillment_sets || []).flatMap(
        (fs: any) => (fs.service_zones || []).map((z: any) => z.id)
      )
      const ids: string[] = []
      for (const zoneId of zoneIds) {
        const res = await api.get(`/admin/shipping-options?service_zone_id=${zoneId}`, adminHeaders)
        ids.push(...(res.data.shipping_options || []).map((o: any) => o.id))
      }
      return { zoneIds, ids }
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Our own warehouse, recorded as ours — prod's location_ownership table
      // is populated (Dharamshala, JYT HQ Delhi), and the job decides an
      // option's side from it. A fresh test DB has no rows at all.
      const stockLocations: any = container.resolve(Modules.STOCK_LOCATION)
      const houseLocation = await stockLocations.createStockLocations({ name: "House Warehouse" })
      const ownership: any = container.resolve("location_ownership")
      await ownership.createLocationOwnerships({
        stock_location_id: houseLocation.id,
        is_core: true,
      })

      // The house profile exists BEFORE any partner store, as on prod. This
      // runner starts with no shipping profiles at all, so it is made here.
      const houseRes = await api.post(
        "/admin/shipping-profiles",
        { name: "Default Shipping Profile", type: "default" },
        adminHeaders
      )
      houseProfileId = houseRes.data.shipping_profile.id

      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const email = `split-${unique}@medusa-test.com`
      await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
      const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
      await api.post(
        "/partners",
        { name: `Split ${unique}`, handle: `split-${unique}`, admin: { email, first_name: "A", last_name: "B" } },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )
      const login2 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      const storeRes = await api.post(
        "/partners/stores",
        {
          store: {
            name: `Split Store ${unique}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          sales_channel: { name: `Split ${unique} - Default` },
          region: { name: "Default Region", currency_code: "usd", countries: ["us"] },
          location: {
            name: "Main Warehouse",
            address: { address_1: "1 Main St", city: "New York", postal_code: "10001", country_code: "US" },
          },
        },
        { headers: partnerHeaders }
      )
      expect(storeRes.status).toBe(201)
      storeId = storeRes.data.store.id
      locationId = storeRes.data.location.id
    })

    it("provisions every option of a new partner store onto the partner profile, not the house one", async () => {
      const partnerId = await partnerProfileId()
      expect(partnerId).not.toBe(houseProfileId)

      const { ids } = await storeOptionIds()
      // Vacuous-pass guard: a store with no options (#1176) would satisfy
      // every assertion below for the wrong reason.
      expect(ids.length).toBeGreaterThan(0)
      const profiles = new Set(await Promise.all(ids.map(profileOfOption)))
      expect([...profiles]).toEqual([partnerId])
    })

    it("puts a partner's product on the partner profile, and ignores a house profile a partner sends for an option", async () => {
      const partnerId = await partnerProfileId()

      const productRes = await api.post(
        `/partners/stores/${storeId}/products`,
        {
          title: "Split Product",
          status: ProductStatus.DRAFT,
          options: [{ title: "Default option", values: ["Default option value"] }],
        },
        { headers: partnerHeaders }
      )
      expect(productRes.status).toBe(201)
      expect(await profileOfProduct(productRes.data.product.id)).toBe(partnerId)

      // A client naming the HOUSE profile must not get it: that would let a
      // partner's courier ship house goods, the crossing the split forbids.
      const { zoneIds } = await storeOptionIds()
      const optionRes = await api.post(
        `/partners/stores/${storeId}/shipping-options`,
        {
          name: "Partner Courier",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: zoneIds[0],
          shipping_profile_id: houseProfileId,
          type: { label: "Courier", description: "Partner courier", code: "partner-courier" },
          prices: [{ amount: 500, currency_code: "usd" }],
        },
        { headers: partnerHeaders }
      )
      expect(optionRes.status).toBe(201)
      expect(await profileOfOption(optionRes.data.shipping_option.id)).toBe(partnerId)
    })

    it("split job: previews without writing, then moves legacy partner rows and leaves house rows alone", async () => {
      const container = getContainer()
      const link: any = container.resolve(ContainerRegistrationKeys.LINK)
      const fulfillment: any = container.resolve(Modules.FULFILLMENT)
      const partnerId = await partnerProfileId()

      // Legacy state: rows created while everything shared the house profile.
      const productRes = await api.post(
        `/partners/stores/${storeId}/products`,
        {
          title: "Legacy Partner Product",
          status: ProductStatus.DRAFT,
          options: [{ title: "Default option", values: ["Default option value"] }],
        },
        { headers: partnerHeaders }
      )
      const legacyProductId = productRes.data.product.id
      await link.dismiss({
        [Modules.PRODUCT]: { product_id: legacyProductId },
        [Modules.FULFILLMENT]: { shipping_profile_id: partnerId },
      })
      await link.create({
        [Modules.PRODUCT]: { product_id: legacyProductId },
        [Modules.FULFILLMENT]: { shipping_profile_id: houseProfileId },
      })
      const { ids } = await storeOptionIds()
      const legacyOptionId = ids[0]
      await fulfillment.updateShippingOptions(legacyOptionId, {
        shipping_profile_id: houseProfileId,
      })

      // A house product — on the house channel, on the house profile.
      const houseChannelId = await resolveHouseSalesChannelId(container)
      expect(houseChannelId).toBeTruthy()
      const houseProductRes = await api.post(
        "/admin/products",
        {
          title: "House Product",
          status: ProductStatus.DRAFT,
          options: [{ title: "Default option", values: ["Default option value"] }],
          sales_channels: [{ id: houseChannelId }],
          shipping_profile_id: houseProfileId,
        },
        adminHeaders
      )
      const houseProductId = houseProductRes.data.product.id

      // The premise, asserted: the legacy rows really are on the house profile.
      expect(await profileOfProduct(legacyProductId)).toBe(houseProfileId)
      expect(await profileOfOption(legacyOptionId)).toBe(houseProfileId)

      // 1. Preview names both moves and writes nothing.
      const preview = await api.post(RUN, { dry_run: true, params: {} }, adminHeaders)
      expect(preview.status).toBe(200)
      expect(preview.data.result.applied).toBe(false)
      const previewIds = preview.data.result.changes.map((c: any) => c.id)
      expect(previewIds).toEqual(expect.arrayContaining([legacyProductId, legacyOptionId]))
      expect(previewIds).not.toContain(houseProductId)
      expect(await profileOfProduct(legacyProductId)).toBe(houseProfileId)
      expect(await profileOfOption(legacyOptionId)).toBe(houseProfileId)

      // 2. Apply moves them — read back from the database.
      const apply = await api.post(RUN, { dry_run: false, params: {} }, adminHeaders)
      expect(apply.status).toBe(200)
      expect(apply.data.result.applied).toBe(true)
      expect(apply.data.result.errors).toBeUndefined()
      expect(await profileOfProduct(legacyProductId)).toBe(partnerId)
      expect(await profileOfOption(legacyOptionId)).toBe(partnerId)
      expect(await profileOfProduct(houseProductId)).toBe(houseProfileId)

      // 3. Idempotent: a second apply finds nothing to move.
      const again = await api.post(RUN, { dry_run: false, params: {} }, adminHeaders)
      expect(again.data.result.changes).toHaveLength(0)
    })
  })
})
