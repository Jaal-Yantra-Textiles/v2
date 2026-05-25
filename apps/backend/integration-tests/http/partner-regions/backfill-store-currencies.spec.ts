import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import backfillStoreCurrencies from "../../../src/scripts/backfill-store-currencies-from-partner-regions"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

// Verifies the second pre-deployment backfill: store.supported_currencies
// expanded to cover every linked region's currency. Sister to the
// backfill-partner-region-links test.
//
// Scenarios:
//   1. Legacy state — store has a linked region (e.g. zar) but the
//      currency was never added to supported_currencies. After the
//      backfill, the currency appears with is_default: false and the
//      pre-existing default is preserved.
//   2. Idempotent — re-runs don't duplicate entries or change order.
//   3. --dry-run leaves the store untouched.
//   4. Stores already covering every linked currency are no-op'd.

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-cur-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })

  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `CurTest ${unique}`,
      handle: `curtest-${unique}`,
      admin: { email, first_name: "Cur", last_name: "Test" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Store ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `Channel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Test St", city: "Anywhere", postal_code: "00000", country_code: "US" },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    storeId: storeRes.data.store.id,
    regionId: storeRes.data.region?.id,
    currencyCode,
  }
}

async function readSupportedCurrencies(container: any, storeId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: "stores",
    filters: { id: storeId },
    fields: ["id", "supported_currencies.currency_code", "supported_currencies.is_default"],
  })
  return (stores?.[0]?.supported_currencies ?? []) as Array<{
    currency_code: string
    is_default?: boolean
  }>
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("scripts/backfill-store-currencies-from-partner-regions", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("adds a region's currency to supported_currencies when missing (legacy state)", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      const storeService = container.resolve(Modules.STORE) as any

      // Simulate the legacy state: partner created an Africa/zar region
      // BEFORE the auto-expand code landed. We model that by creating
      // a region via admin (skipping the partner auto-expand path),
      // linking it to the partner, then forcing the store back to
      // single-currency to mimic "this currency was never added".
      const adminRegionRes = await api.post(
        "/admin/regions",
        { name: "Africa", currency_code: "zar", countries: ["za"] },
        adminHeaders
      )
      const zarRegionId = adminRegionRes.data.region.id
      await remoteLink.create({
        partner: { partner_id: a.partnerId },
        [Modules.REGION]: { region_id: zarRegionId },
      })
      // Force the legacy state: only the original USD entry on the store.
      await storeService.updateStores({
        id: a.storeId,
        supported_currencies: [{ currency_code: a.currencyCode, is_default: true }],
      })

      const before = await readSupportedCurrencies(container, a.storeId)
      expect(before.map((c) => c.currency_code).sort()).toEqual([a.currencyCode])

      await backfillStoreCurrencies({ container, args: [] } as any)

      const after = await readSupportedCurrencies(container, a.storeId)
      const codes = after.map((c) => c.currency_code).sort()
      expect(codes).toEqual([a.currencyCode, "zar"].sort())
      // The default flag survived on the original currency.
      const usdEntry = after.find((c) => c.currency_code === a.currencyCode)
      const zarEntry = after.find((c) => c.currency_code === "zar")
      expect(usdEntry?.is_default).toBe(true)
      expect(zarEntry?.is_default).toBe(false)
    })

    it("is a no-op for stores already covering every linked region currency", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()

      // The provisioning workflow already wires currencyCode into both
      // the region and supported_currencies. No legacy gap to fix.
      const before = await readSupportedCurrencies(container, a.storeId)
      await backfillStoreCurrencies({ container, args: [] } as any)
      const after = await readSupportedCurrencies(container, a.storeId)
      expect(after.map((c) => c.currency_code).sort()).toEqual(
        before.map((c) => c.currency_code).sort()
      )
    })

    it("is idempotent across consecutive runs", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      const storeService = container.resolve(Modules.STORE) as any

      // Same legacy-state setup as scenario 1.
      const adminRegionRes = await api.post(
        "/admin/regions",
        { name: "Africa", currency_code: "zar", countries: ["za"] },
        adminHeaders
      )
      await remoteLink.create({
        partner: { partner_id: a.partnerId },
        [Modules.REGION]: { region_id: adminRegionRes.data.region.id },
      })
      await storeService.updateStores({
        id: a.storeId,
        supported_currencies: [{ currency_code: a.currencyCode, is_default: true }],
      })

      await backfillStoreCurrencies({ container, args: [] } as any)
      const first = await readSupportedCurrencies(container, a.storeId)
      expect(first.length).toBe(2)

      // Re-run.
      await backfillStoreCurrencies({ container, args: [] } as any)
      const second = await readSupportedCurrencies(container, a.storeId)
      expect(second.length).toBe(2)
      expect(second.map((c) => c.currency_code).sort()).toEqual(
        first.map((c) => c.currency_code).sort()
      )
    })

    it("--dry-run leaves the store untouched", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      const storeService = container.resolve(Modules.STORE) as any

      const adminRegionRes = await api.post(
        "/admin/regions",
        { name: "Africa", currency_code: "zar", countries: ["za"] },
        adminHeaders
      )
      await remoteLink.create({
        partner: { partner_id: a.partnerId },
        [Modules.REGION]: { region_id: adminRegionRes.data.region.id },
      })
      await storeService.updateStores({
        id: a.storeId,
        supported_currencies: [{ currency_code: a.currencyCode, is_default: true }],
      })

      const before = await readSupportedCurrencies(container, a.storeId)

      await backfillStoreCurrencies({ container, args: ["--dry-run"] } as any)

      const after = await readSupportedCurrencies(container, a.storeId)
      expect(after.map((c) => c.currency_code).sort()).toEqual(
        before.map((c) => c.currency_code).sort()
      )
    })
  })
})
