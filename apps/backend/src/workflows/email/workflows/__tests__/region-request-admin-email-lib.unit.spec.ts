import {
  buildRegionRequestAdminEmailData,
  resolveRegionRequestRecipient,
} from "../region-request-admin-email-lib"

describe("region-request-admin-email lib (#576 slice C)", () => {
  describe("resolveRegionRequestRecipient", () => {
    it("prefers REGION_REQUEST_NOTIFY_EMAIL", () => {
      const r = resolveRegionRequestRecipient({
        REGION_REQUEST_NOTIFY_EMAIL: "ops@jaalyantra.com",
        ADMIN_NOTIFY_EMAIL: "admin@jaalyantra.com",
        MAILJET_FROM_EMAIL: "from@jaalyantra.com",
      })
      expect(r).toEqual({
        email: "ops@jaalyantra.com",
        source: "REGION_REQUEST_NOTIFY_EMAIL",
      })
    })

    it("falls back to ADMIN_NOTIFY_EMAIL when the primary is unset", () => {
      const r = resolveRegionRequestRecipient({
        ADMIN_NOTIFY_EMAIL: "admin@jaalyantra.com",
        MAILJET_FROM_EMAIL: "from@jaalyantra.com",
      })
      expect(r?.email).toBe("admin@jaalyantra.com")
      expect(r?.source).toBe("ADMIN_NOTIFY_EMAIL")
    })

    it("falls back to MAILJET_FROM_EMAIL as the last resort", () => {
      const r = resolveRegionRequestRecipient({
        MAILJET_FROM_EMAIL: "from@jaalyantra.com",
      })
      expect(r?.email).toBe("from@jaalyantra.com")
      expect(r?.source).toMatch(/MAILJET_FROM_EMAIL/)
    })

    it("trims surrounding whitespace", () => {
      const r = resolveRegionRequestRecipient({
        REGION_REQUEST_NOTIFY_EMAIL: "  ops@jaalyantra.com  ",
      })
      expect(r?.email).toBe("ops@jaalyantra.com")
    })

    it("returns null when nothing is configured", () => {
      expect(resolveRegionRequestRecipient({})).toBeNull()
    })

    it("ignores non-email values (no @)", () => {
      const r = resolveRegionRequestRecipient({
        REGION_REQUEST_NOTIFY_EMAIL: "not-an-email",
        ADMIN_NOTIFY_EMAIL: "real@jaalyantra.com",
      })
      expect(r?.email).toBe("real@jaalyantra.com")
    })

    it("treats empty strings as unset", () => {
      const r = resolveRegionRequestRecipient({
        REGION_REQUEST_NOTIFY_EMAIL: "",
        ADMIN_NOTIFY_EMAIL: "   ",
        MAILJET_FROM_EMAIL: "floor@jaalyantra.com",
      })
      expect(r?.email).toBe("floor@jaalyantra.com")
    })
  })

  describe("buildRegionRequestAdminEmailData", () => {
    it("assembles a full payload and upper-cases the country code", () => {
      const data = buildRegionRequestAdminEmailData({
        name: "Asha",
        email: "asha@example.com",
        message: "Please ship to Nepal",
        countryCode: "np",
        productHandle: "silk-saree",
        storeId: "store_1",
        storeName: "Asha Textiles",
        receivedAt: "2026-06-21T00:00:00.000Z",
      })
      expect(data).toEqual({
        title: "Region request: customer in NP",
        name: "Asha",
        email: "asha@example.com",
        message: "Please ship to Nepal",
        country_code: "NP",
        product_handle: "silk-saree",
        store_id: "store_1",
        store_name: "Asha Textiles",
        received_at: "2026-06-21T00:00:00.000Z",
      })
    })

    it("uses the generic title and nulls when country code is absent", () => {
      const data = buildRegionRequestAdminEmailData({
        name: "Bo",
        email: "bo@example.com",
      })
      expect(data.title).toBe("Region request: storefront contact")
      expect(data.country_code).toBeNull()
      expect(data.message).toBeNull()
      expect(data.product_handle).toBeNull()
      expect(data.store_name).toBeNull()
    })

    it("coerces blank optional fields to null", () => {
      const data = buildRegionRequestAdminEmailData({
        name: "Cy",
        email: "cy@example.com",
        message: "   ",
        productHandle: "  ",
        storeName: "",
      })
      expect(data.message).toBeNull()
      expect(data.product_handle).toBeNull()
      expect(data.store_name).toBeNull()
    })
  })
})
