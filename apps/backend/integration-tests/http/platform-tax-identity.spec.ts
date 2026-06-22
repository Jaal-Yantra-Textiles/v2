import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { resolvePlatformTaxIdentity } from "../../src/modules/platform-tax-identity/resolve-lib"
import {
  resolveSellerTaxIdForOrder,
  resolvePlatformTaxIdForCountry,
} from "../../src/modules/shipping-providers/seller-tax-id"

jest.setTimeout(60 * 1000)

/**
 * Issue #348 slice B — verifies the admin-managed `platform_tax_identity` table
 * (model + service) persists rows and that the seller-tax-ID resolver threads the
 * country-based platform fallback through a real container — the value carriers
 * stamp on labels (Shiprocket `gstin`, Delhivery `seller_gst_tin`).
 *
 * NB: the shared harness TRUNCATEs all tables, so the migration's seed rows do
 * not survive into the test DB — we create the identities through the service
 * here. The real seed lives in the migration (verified by the SQL + unit tests).
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  // The Medusa test runner clears the DB before each test, so seed per-test.
  const seed = async () => {
    const service: any = getContainer().resolve("platform_tax_identity")
    const existing = await service.listPlatformTaxIdentities()
    if (existing.length) {
      return
    }
    await service.createPlatformTaxIdentities([
      {
        brand_code: "JYT",
        legal_name: "Jaal Yantra Textiles Private Limited",
        tax_id: "07AAGCJ0494A1ZV",
        tax_id_type: "gstin",
        country_codes: ["IN"],
        is_active: true,
      },
      {
        brand_code: "KHT",
        legal_name: "Kind Health Tech",
        tax_id: "40203579735",
        tax_id_type: "eu_vat",
        country_codes: [
          "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
          "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT",
          "RO", "SK", "SI", "ES", "SE",
        ],
        is_active: true,
      },
    ])
  }

  it("persists platform identities and the pure resolver matches by country", async () => {
    await seed()
    const service: any = getContainer().resolve("platform_tax_identity")
    const rows = await service.listPlatformTaxIdentities()
    const byBrand = Object.fromEntries(rows.map((r: any) => [r.brand_code, r]))

    expect(byBrand.JYT?.tax_id).toBe("07AAGCJ0494A1ZV")
    expect(byBrand.JYT?.country_codes).toContain("IN")
    expect(byBrand.KHT?.tax_id).toBe("40203579735")
    expect(byBrand.KHT?.country_codes).toContain("LV")
    expect(byBrand.KHT?.country_codes).toHaveLength(27)

    expect(resolvePlatformTaxIdentity("IN", rows)?.brand_code).toBe("JYT")
    expect(resolvePlatformTaxIdentity("FR", rows)?.brand_code).toBe("KHT")
  })

  it("resolveSellerTaxIdForOrder falls back to the platform ID by country (no partner)", async () => {
    await seed()
    const container = getContainer()
    expect(await resolveSellerTaxIdForOrder(container, null, "IN")).toBe(
      "07AAGCJ0494A1ZV"
    )
    expect(await resolveSellerTaxIdForOrder(container, null, "FR")).toBe(
      "40203579735"
    )
    // Jurisdiction with no platform entity → undefined (source "none").
    expect(
      await resolveSellerTaxIdForOrder(container, null, "US")
    ).toBeUndefined()
    // Malformed/missing country → undefined, never throws.
    expect(
      await resolveSellerTaxIdForOrder(container, null, null)
    ).toBeUndefined()
  })

  it("resolvePlatformTaxIdForCountry returns the platform-only fallback", async () => {
    await seed()
    const container = getContainer()
    expect(await resolvePlatformTaxIdForCountry(container, "in")).toBe(
      "07AAGCJ0494A1ZV"
    )
    expect(await resolvePlatformTaxIdForCountry(container, "de")).toBe(
      "40203579735"
    )
    expect(
      await resolvePlatformTaxIdForCountry(container, "US")
    ).toBeUndefined()
  })
})
