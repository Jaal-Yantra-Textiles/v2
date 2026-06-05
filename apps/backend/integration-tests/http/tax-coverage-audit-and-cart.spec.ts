/**
 * Tax coverage audit + cart tax materialization (roadmap item 5).
 *
 * Two angles, one spec:
 *
 *   1. `scripts/audit-tax-coverage.ts` correctly surfaces partner
 *      regions whose covered countries lack a canonical tax_region —
 *      and stays silent when every country is covered.
 *
 *   2. Medusa's TaxModule actually computes the right tax rate for a
 *      partner cart-shaped scenario once the canonical seed has run.
 *      This guards the e2e contract: AU shipping address → 10% GST
 *      line, IN shipping address → 18% GST line. If this stops
 *      working, every partner under-bills their customers.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/tax-coverage-audit-and-cart
 */

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import seedCanonicalTaxRegions from "../../src/scripts/seed-canonical-tax-regions"
import { computeTaxCoverage } from "../../src/scripts/audit-tax-coverage"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(180_000)

async function createPartnerWithRegion(
  api: any,
  adminHeaders: any,
  label: string,
  countries: string[]
) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `tax5-${label}-${unique}@jyt.test`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: PARTNER_PASSWORD,
  })
  let login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  let partnerHeaders: Record<string, string> = {
    Authorization: `Bearer ${login.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `Tax5 ${label} ${unique}`,
      handle: `tax5-${label}-${unique}`,
      admin: { email, first_name: "Tax", last_name: "Test" },
    },
    { headers: partnerHeaders }
  )
  expect(partnerRes.status).toBe(200)
  const partnerId = partnerRes.data.partner.id as string

  // Re-login to refresh actor scope after partner creation.
  login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  partnerHeaders = { Authorization: `Bearer ${login.data.token}` }

  // Use USD across the board — partner-stores route requires the
  // currency be present in admin's supported list, and USD is the
  // only one we can rely on in a fresh test DB. The tax test cares
  // about `country`, not currency, so a region can be USD-denominated
  // while covering AU or IN without changing what tax_region matches.
  const currencyCode = "usd"

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Tax5 Store ${label} ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      region: {
        name: `Tax5 ${label} Region`,
        currency_code: currencyCode,
        countries,
      },
      location: {
        name: "Warehouse",
        address: {
          address_1: "1 Test St",
          city: "Test",
          postal_code: "00000",
          country_code: countries[0].toUpperCase(),
        },
      },
    },
    { headers: partnerHeaders }
  )
  // partner-stores has returned both 200 and 201 historically — the
  // partner-tax-pricing-api spec doesn't even assert on it. Accept
  // either to keep this resilient.
  expect([200, 201]).toContain(storeRes.status)
  return {
    partnerId,
    partnerHeaders,
    regionId: storeRes.data.region?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("audit-tax-coverage (roadmap 5)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      // Partner-created notification template — created by the
      // partner-creation flow. Pre-seed so failures here don't mask
      // the real assertions.
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {
        /* ignore — pre-existing */
      }
    })

    it("reports zero gaps when every partner-covered country has a tax_region", async () => {
      const container = getContainer()

      // Partner creates the AU region (Medusa enforces 1 country → 1
      // region globally, so the partner-side creation occupies AU).
      const { partnerId } = await createPartnerWithRegion(
        api,
        adminHeaders,
        "no-gap",
        ["au"]
      )
      // Seed walks every region — including partner-created ones —
      // and creates a tax_region per country. AU = 10% GST.
      await seedCanonicalTaxRegions({ container, args: [] } as any)

      // Audit, scoped to just this partner so other test fixtures
      // don't pollute the report shape.
      const report = await computeTaxCoverage(container, {
        partnerIdFilter: [partnerId],
      })

      expect(report.partners_audited).toBe(1)
      expect(report.partners_with_gaps).toBe(0)
      expect(report.globally_missing).toEqual([])
      expect(report.per_partner[0].covered).toContain("au")
      expect(report.per_partner[0].missing).toEqual([])
    })

    it("surfaces a partner whose region covers a country with no canonical tax_region", async () => {
      const container = getContainer()

      // Partner covers AU + AO. AO is intentionally not in
      // COUNTRY_DEFAULT_TAX_RATES so seed-canonical-tax-regions creates
      // a row without a default_tax_rate — for the audit it's the same
      // as "no row" (no rate → no tax computed → audit flags it).
      // Use distinct partner labels per test so country occupation
      // from a sibling test doesn't bleed across.
      const { partnerId } = await createPartnerWithRegion(
        api,
        adminHeaders,
        "with-gap",
        ["nz", "ao"]
      )
      await seedCanonicalTaxRegions({ container, args: [] } as any)

      const report = await computeTaxCoverage(container, {
        partnerIdFilter: [partnerId],
      })

      expect(report.partners_audited).toBe(1)
      // AO has no canonical default_tax_rate, so the audit sees it
      // as covered-but-untaxed. NZ is 15% GST.
      expect(report.per_partner[0].covered).toContain("nz")
      expect(report.per_partner[0].covered).not.toContain("ao")
      expect(report.per_partner[0].missing).toContain("ao")
      expect(report.globally_missing).toContain("ao")
    })

    it("does not flag US as missing — partners handle US state-level tax themselves", async () => {
      const container = getContainer()
      const { partnerId } = await createPartnerWithRegion(
        api,
        adminHeaders,
        "us-only",
        ["us"]
      )

      const report = await computeTaxCoverage(container, {
        partnerIdFilter: [partnerId],
      })

      expect(report.partners_with_gaps).toBe(0)
      expect(report.per_partner[0].missing).not.toContain("us")
      expect(report.per_partner[0].review_needed).toEqual([])
    })

    it("flags IN-covering partners for review (price-band rule limitation)", async () => {
      const container = getContainer()

      // Partner covers IN. Seed canonical so the row + 18% default
      // exist — i.e. coverage is fine; the review flag exists
      // because India's actual statutory rate is 5%/18% split at
      // ₹2,500/piece which Medusa's tax_rate_rules can't express.
      const { partnerId } = await createPartnerWithRegion(
        api,
        adminHeaders,
        "in-only",
        ["in"]
      )
      await seedCanonicalTaxRegions({ container, args: [] } as any)

      const report = await computeTaxCoverage(container, {
        partnerIdFilter: [partnerId],
      })

      expect(report.partners_with_gaps).toBe(0)
      expect(report.partners_with_reviews).toBe(1)
      expect(report.per_partner[0].review_needed).toContain("in")
      expect(report.per_partner[0].covered).toContain("in")
    })
  })

  describe("TaxModule cart materialization (roadmap 5)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("returns the expected GST rate for a shipping address in AU", async () => {
      const container = getContainer()
      await api.post(
        "/admin/regions",
        { name: "AU for tax calc", currency_code: "aud", countries: ["au"] },
        adminHeaders
      )
      await seedCanonicalTaxRegions({ container, args: [] } as any)

      const taxService: any = container.resolve(Modules.TAX)
      const lines = await taxService.getTaxLines(
        [
          {
            id: "li_test_au",
            product_id: "prod_test",
            quantity: 1,
            unit_price: 10000,
            currency_code: "aud",
          },
        ],
        {
          address: { country_code: "au" },
        }
      )

      expect(Array.isArray(lines)).toBe(true)
      expect(lines.length).toBeGreaterThan(0)
      const taxLine = lines.find((l: any) => l.line_item_id === "li_test_au")
      expect(taxLine).toBeDefined()
      // Australia GST = 10% per COUNTRY_DEFAULT_TAX_RATES.
      expect(Number(taxLine.rate)).toBe(10)
      expect(String(taxLine.code)).toBe("AU-GST")
    })

    it("returns the expected GST rate for a shipping address in IN", async () => {
      const container = getContainer()
      await api.post(
        "/admin/regions",
        { name: "IN for tax calc", currency_code: "inr", countries: ["in"] },
        adminHeaders
      )
      await seedCanonicalTaxRegions({ container, args: [] } as any)

      const taxService: any = container.resolve(Modules.TAX)
      const lines = await taxService.getTaxLines(
        [
          {
            id: "li_test_in",
            product_id: "prod_test",
            quantity: 1,
            unit_price: 10000,
            currency_code: "inr",
          },
        ],
        {
          address: { country_code: "in" },
        }
      )

      const taxLine = lines.find((l: any) => l.line_item_id === "li_test_in")
      expect(taxLine).toBeDefined()
      // India GST = 18% per COUNTRY_DEFAULT_TAX_RATES.
      expect(Number(taxLine.rate)).toBe(18)
      expect(String(taxLine.code)).toBe("IN-GST")
    })

    it("returns no tax lines when the shipping country has no canonical tax_region", async () => {
      // Sanity: prove that the silent-undercharge bug really would
      // bite if a partner covers a country we haven't seeded. AO has
      // no entry in COUNTRY_DEFAULT_TAX_RATES, so even running the
      // seed leaves it uncovered.
      const container = getContainer()
      const taxService: any = container.resolve(Modules.TAX)
      const lines = await taxService.getTaxLines(
        [
          {
            id: "li_test_ao",
            product_id: "prod_test",
            quantity: 1,
            unit_price: 10000,
            currency_code: "usd",
          },
        ],
        {
          address: { country_code: "ao" },
        }
      )
      const taxLine = lines.find((l: any) => l.line_item_id === "li_test_ao")
      // Either no line at all, or a zero-rate line — both mean the
      // partner under-bills. The audit script is the alarm.
      const rate = taxLine ? Number(taxLine.rate) : 0
      expect(rate).toBe(0)
    })
  })
})
