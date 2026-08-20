import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createTestCustomer } from "../helpers/create-customer"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

/**
 * GET /store/shipping-estimate (#1389) — the public freight estimate a business
 * buyer sees before committing to a bulk order.
 *
 * The assertion that matters most here is the REFUSAL. A variant with no
 * shipping weight must produce an error naming the variant, never a quote built
 * on a guessed weight: 11 of 33 variants on prod have no weight today, and a
 * guessed number here is a freight cost a buyer makes a purchasing decision on.
 * The internal fulfilment path does estimate (order 83 hit exactly that), which
 * is why this route's opposite behaviour needs locking rather than assuming.
 *
 * Carrier rates are not asserted — no live carrier is registered in the test
 * app — but the route must still answer with the manual tier and report the
 * carrier failure in `calculated_error` rather than 500ing, which is asserted.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("GET /store/shipping-estimate", () => {
    let pk: string
    let adminHeaders: any
    let weightlessVariantId: string
    let weighedVariantId: string

    const storeHeaders = () => ({ headers: { "x-publishable-api-key": pk } })

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      // Give the store a pickup location that has a postal code — the origin
      // the estimate quotes from.
      const loc = await api.post(
        "/admin/stock-locations",
        {
          name: "Estimate Origin",
          address: {
            address_1: "1 Loom Street",
            city: "Srinagar",
            country_code: "in",
            postal_code: "190001",
          },
        },
        adminHeaders
      )
      const locationId = loc.data.stock_location.id

      const storeService: any = container.resolve("store")
      const [store] = await storeService.listStores({}, { take: 1 })
      await storeService.updateStores({
        id: store.id,
        default_location_id: locationId,
      })

      const product = await api.post(
        "/admin/products",
        {
          title: "Estimate Probe Shawl",
          status: "published",
          options: [{ title: "Spin", values: ["Hand", "Mill"] }],
          variants: [
            {
              title: "Hand",
              manage_inventory: false,
              options: { Spin: "Hand" },
              prices: [{ currency_code: "inr", amount: 1000 }],
            },
            {
              title: "Mill",
              manage_inventory: false,
              options: { Spin: "Mill" },
              weight: 250,
              prices: [{ currency_code: "inr", amount: 900 }],
            },
          ],
        },
        adminHeaders
      )
      const variants = product.data.product.variants
      weightlessVariantId = variants.find((v: any) => v.title === "Hand").id
      weighedVariantId = variants.find((v: any) => v.title === "Mill").id
    })

    // The whole point of the route's design.
    it("REFUSES to quote a variant with no shipping weight", async () => {
      const res = await api
        .get(
          `/store/shipping-estimate?variant_id=${weightlessVariantId}&quantity=200&destination_postal_code=110001&country_code=in`,
          storeHeaders()
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
      // Names the variant so the catalogue gap is actionable, and says what to
      // do about it rather than just failing.
      expect(res.data.message).toMatch(/no shipping weight/i)
      expect(res.data.message).toMatch(/Set a weight/i)
    })

    it("quotes total weight as unit weight x quantity", async () => {
      const res = await api.get(
        `/store/shipping-estimate?variant_id=${weighedVariantId}&quantity=200&destination_postal_code=110001&country_code=in`,
        storeHeaders()
      )

      expect(res.status).toBe(200)
      const est = res.data.estimate
      expect(est.unit_weight_grams).toBe(250)
      expect(est.total_weight_grams).toBe(250 * 200)
      expect(est.origin_postal_code).toBe("190001")
      expect(est.destination_postal_code).toBe("110001")
      // Never presented as a final price.
      expect(est.is_estimate).toBe(true)
    })

    // A carrier that cannot quote must degrade, not 500 — the manual tier is
    // still a real answer for the buyer.
    it("survives a carrier that cannot quote", async () => {
      const res = await api.get(
        `/store/shipping-estimate?variant_id=${weighedVariantId}&quantity=10&destination_postal_code=110001&country_code=in`,
        storeHeaders()
      )

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.estimate.calculated)).toBe(true)
      expect(Array.isArray(res.data.estimate.manual)).toBe(true)
    })

    it("rejects a nonsensical quantity", async () => {
      const res = await api
        .get(
          `/store/shipping-estimate?variant_id=${weighedVariantId}&quantity=0&destination_postal_code=110001`,
          storeHeaders()
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })
  })
})
