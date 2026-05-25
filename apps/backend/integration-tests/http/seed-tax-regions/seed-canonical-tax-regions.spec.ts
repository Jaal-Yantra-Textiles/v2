import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import seedCanonicalTaxRegions from "../../../src/scripts/seed-canonical-tax-regions"

jest.setTimeout(120 * 1000)

// Verifies the canonical tax-region seed script. Sister to the
// backfill scripts under partner-regions/. This one walks every
// region's countries and ensures a tax_region exists for each (with
// the appropriate default_tax_rate from the curated table).
//
// Scenarios:
//   1. Creates tax_regions for countries that didn't have one, with
//      the known default rate where available.
//   2. Idempotent — re-runs don't duplicate.
//   3. --dry-run leaves the DB untouched.
//   4. Skips US (no federal sales tax).

async function readTaxRegionsForCountry(container: any, countryCode: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "tax_regions",
    filters: { country_code: countryCode.toLowerCase() },
    fields: [
      "id",
      "country_code",
      "parent_id",
      "tax_rates.rate",
      "tax_rates.code",
      "tax_rates.is_default",
    ],
  })
  return (data ?? []).filter((tr: any) => !tr.parent_id) // roots only
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("scripts/seed-canonical-tax-regions", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("creates a tax_region for a country that didn't have one (with known rate)", async () => {
      // Set up a region with country=au (Australia, known rate: 10% GST).
      // No tax_region exists for au yet in a fresh test DB.
      const container = getContainer()
      const regionRes = await api.post(
        "/admin/regions",
        { name: "Test Australia", currency_code: "aud", countries: ["au"] },
        adminHeaders
      )
      expect(regionRes.status).toBe(200)

      const before = await readTaxRegionsForCountry(container, "au")
      expect(before.length).toBe(0)

      await seedCanonicalTaxRegions({ container, args: [] } as any)

      const after = await readTaxRegionsForCountry(container, "au")
      expect(after.length).toBe(1)

      // Default rate should be 10% per the COUNTRY_DEFAULT_TAX_RATES table.
      const defaultRate = (after[0].tax_rates ?? []).find((r: any) => r.is_default)
      expect(defaultRate).toBeDefined()
      expect(defaultRate.rate).toBe(10)
      expect(defaultRate.code).toBe("AU-GST")
    })

    it("is idempotent — re-runs don't create duplicates", async () => {
      const container = getContainer()
      await api.post(
        "/admin/regions",
        { name: "Test NZ", currency_code: "nzd", countries: ["nz"] },
        adminHeaders
      )

      await seedCanonicalTaxRegions({ container, args: [] } as any)
      const afterFirst = await readTaxRegionsForCountry(container, "nz")
      expect(afterFirst.length).toBe(1)

      await seedCanonicalTaxRegions({ container, args: [] } as any)
      const afterSecond = await readTaxRegionsForCountry(container, "nz")
      expect(afterSecond.length).toBe(1)
      expect(afterSecond[0].id).toBe(afterFirst[0].id)
    })

    it("--dry-run does not create any tax_regions", async () => {
      const container = getContainer()
      await api.post(
        "/admin/regions",
        { name: "Test SG", currency_code: "sgd", countries: ["sg"] },
        adminHeaders
      )

      const before = await readTaxRegionsForCountry(container, "sg")
      expect(before.length).toBe(0)

      await seedCanonicalTaxRegions({ container, args: ["--dry-run"] } as any)

      const after = await readTaxRegionsForCountry(container, "sg")
      expect(after.length).toBe(0)
    })

    it("skips US (no federal sales tax)", async () => {
      const container = getContainer()
      await api.post(
        "/admin/regions",
        { name: "Test America", currency_code: "usd", countries: ["us"] },
        adminHeaders
      )

      await seedCanonicalTaxRegions({ container, args: [] } as any)

      const after = await readTaxRegionsForCountry(container, "us")
      expect(after.length).toBe(0)
    })

    it("DRY_RUN=1 env var also triggers dry-run mode", async () => {
      // run-backfill.sh sets DRY_RUN as a container env var. Both args
      // and env-var paths must trigger dry-run so ECS-spawned previews
      // don't silently create rows.
      const container = getContainer()
      await api.post(
        "/admin/regions",
        { name: "Test JP", currency_code: "jpy", countries: ["jp"] },
        adminHeaders
      )

      const before = await readTaxRegionsForCountry(container, "jp")
      expect(before.length).toBe(0)

      const prev = process.env.DRY_RUN
      process.env.DRY_RUN = "1"
      try {
        await seedCanonicalTaxRegions({ container, args: [] } as any)
      } finally {
        if (prev === undefined) delete process.env.DRY_RUN
        else process.env.DRY_RUN = prev
      }

      const after = await readTaxRegionsForCountry(container, "jp")
      expect(after.length).toBe(0)
    })
  })
})
