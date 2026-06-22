import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import {
  resolvePlatformTaxIdForCountry,
  resolveSellerTaxIdForOrder,
} from "../../src/modules/shipping-providers/seller-tax-id"

jest.setTimeout(60 * 1000)

/**
 * Issue #348 slice B — verifies the seller-tax-ID resolution that threads into
 * carrier label payloads (Delhivery `seller_gst_tin`, Shiprocket `gstin`).
 *
 * `resolveSellerTaxIdForOrder` does the I/O (partner↔order link + partner row)
 * and delegates the precedence math to the pure `resolveTaxIdForCountry`. With
 * no partner link it must degrade to the platform fallback chosen by country —
 * never throw — so a missing partner / un-migrated tax_id column can't block a
 * label.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  const ORIG_ENV = { ...process.env }
  beforeAll(() => {
    process.env.PLATFORM_TAX_ID_JYT = "JYT-PLATFORM-GSTIN"
    process.env.PLATFORM_TAX_ID_KHT = "KHT-PLATFORM-VAT"
  })
  afterAll(() => {
    process.env.PLATFORM_TAX_ID_JYT = ORIG_ENV.PLATFORM_TAX_ID_JYT
    process.env.PLATFORM_TAX_ID_KHT = ORIG_ENV.PLATFORM_TAX_ID_KHT
  })

  it("falls back to the platform GSTIN by country when no partner link exists", async () => {
    const container = getContainer()
    // A non-existent order id → no partner↔order link → platform fallback.
    const inTaxId = await resolveSellerTaxIdForOrder(
      container,
      "order_does_not_exist_in",
      "IN"
    )
    expect(inTaxId).toBe("JYT-PLATFORM-GSTIN")

    const euTaxId = await resolveSellerTaxIdForOrder(
      container,
      "order_does_not_exist_eu",
      "DE"
    )
    expect(euTaxId).toBe("KHT-PLATFORM-VAT")
  })

  it("returns undefined for a jurisdiction the platform has no entity in", async () => {
    const container = getContainer()
    const usTaxId = await resolveSellerTaxIdForOrder(
      container,
      "order_does_not_exist_us",
      "US"
    )
    expect(usTaxId).toBeUndefined()
  })

  it("resolvePlatformTaxIdForCountry maps country→platform GSTIN/VAT (no I/O)", () => {
    expect(resolvePlatformTaxIdForCountry("India")).toBe("JYT-PLATFORM-GSTIN")
    expect(resolvePlatformTaxIdForCountry("FR")).toBe("KHT-PLATFORM-VAT")
    expect(resolvePlatformTaxIdForCountry("US")).toBeUndefined()
  })
})
