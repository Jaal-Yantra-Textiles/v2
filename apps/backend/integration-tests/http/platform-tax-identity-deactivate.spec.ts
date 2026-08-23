import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PLATFORM_TAX_IDENTITY_MODULE } from "../../src/modules/platform-tax-identity"
import { resolveSellerTaxIdForOrder } from "../../src/modules/shipping-providers/seller-tax-id"

jest.setTimeout(60 * 1000)

/**
 * #348 — retiring a platform tax identity, end to end.
 *
 * The KHT row (Kind Health Tech SIA) was seeded as an EU VAT identity covering
 * all 27 member states for an entity that is NOT VAT-registered and never ships:
 * it invoices and collects on JYT's behalf while goods go direct from India.
 * `40203579735` is its Uzņēmumu reģistrs company number, not a VAT number.
 *
 * Two facts are asserted here that a unit test on the pure resolver cannot show,
 * because both depend on the real container and the real module service:
 *
 *  1. The job actually retires the row — after it runs, a seller-tax-ID lookup
 *     for an EU jurisdiction resolves nothing rather than KHT's number.
 *  2. 🔑 Relabelling `tax_id_type` does NOT retire it. That is the trap: the
 *     obvious "fix" for a row that claims the wrong kind of ID is to correct the
 *     kind, and it changes nothing, because `resolvePlatformTaxIdString` returns
 *     `tax_id` without ever reading the type. Only `is_active` is a lever.
 *
 * ⚠️ `Migration20260622140000` seeds both identities with FIXED ids
 * (`ptid_jyt_in`, `ptid_kht_eu`) and those rows DO survive into the test DB —
 * contrary to the note on the sibling suite `platform-tax-identity.spec.ts`,
 * which says the runner clears them and seeds per test. That suite is saved by
 * an existence guard, so it never actually duplicated anything; an
 * unconditional create here did, immediately, and the count assertion below is
 * what caught it. Seeding is therefore create-if-absent, and this suite counts
 * rows rather than folding them through a brand-keyed map.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  const JYT = {
    brand_code: "JYT",
    legal_name: "Jaal Yantra Textiles Private Limited",
    tax_id: "07AAGCJ0494A1ZV",
    tax_id_type: "gstin",
    country_codes: ["IN"],
    is_active: true,
  }
  const KHT = {
    brand_code: "KHT",
    legal_name: "Kind Health Tech SIA",
    tax_id: "40203579735",
    tax_id_type: "eu_vat",
    country_codes: ["DE", "FR", "LV"],
    is_active: true,
  }

  const brandRows = async (brand_code: string) => {
    const service: any = getContainer().resolve(PLATFORM_TAX_IDENTITY_MODULE)
    return (await service.listPlatformTaxIdentities({ brand_code })) ?? []
  }

  const brandRow = async (brand_code: string) => (await brandRows(brand_code))[0]

  /**
   * Create-if-absent, and re-activate what the migration seeded — a previous
   * test in the same worker may have retired it. Creating unconditionally would
   * duplicate the migration's rows and make every count assertion below a lie.
   */
  const seed = async () => {
    const service: any = getContainer().resolve(PLATFORM_TAX_IDENTITY_MODULE)
    for (const row of [JYT, KHT]) {
      const existing = await brandRow(row.brand_code)
      if (existing) {
        await service.updatePlatformTaxIdentities({
          id: existing.id,
          is_active: true,
          tax_id_type: row.tax_id_type,
        })
      } else {
        await service.createPlatformTaxIdentities([row])
      }
    }
  }

  describe("set-platform-tax-identity-active", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await seed()
    })

    it("is listed in the registry with both params required", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)

      const job = res.data.jobs.find(
        (j: any) => j.id === "set-platform-tax-identity-active"
      )
      expect(job).toBeDefined()
      expect(job.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "brand_code", required: true }),
          expect.objectContaining({ name: "is_active", required: true }),
        ])
      )
    })

    it("dry-run reports the change and writes nothing", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/set-platform-tax-identity-active/run",
        { dry_run: true, params: { brand_code: "KHT", is_active: false } },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.applied).toBe(false)
      // Exactly one KHT row exists, so exactly one change is reported. Asserting
      // the count is the point: it is what catches a duplicate identity, which
      // is precisely the state the sibling suite created and could not see.
      expect(await brandRows("KHT")).toHaveLength(1)
      expect(res.data.result.changes).toEqual([
        expect.objectContaining({
          entity: "platform_tax_identity",
          field: "is_active",
          before: "true",
          after: "false",
        }),
      ])

      // The row is untouched — a dry run that writes is the whole reason the
      // flag exists.
      expect((await brandRow("KHT"))?.is_active).toBe(true)
    })

    it("apply retires KHT, and the seller-tax-ID lookup stops answering with it", async () => {
      const container = getContainer()

      // Before: an EU-origin lookup resolves the Latvian company number. This is
      // the value that was reaching `tax_id` on shipment payloads.
      expect(await resolveSellerTaxIdForOrder(container, null, "DE")).toBe(
        "40203579735"
      )

      const res = await api.post(
        "/admin/ops/maintenance-jobs/set-platform-tax-identity-active/run",
        { dry_run: false, params: { brand_code: "KHT", is_active: false } },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.applied).toBe(true)
      expect((await brandRow("KHT"))?.is_active).toBe(false)

      // After: nothing to stamp, rather than the wrong thing to stamp.
      expect(
        await resolveSellerTaxIdForOrder(container, null, "DE")
      ).toBeUndefined()

      // 🔴 And the India-origin answer — the one that actually matters, because
      // every shipment leaves India — is untouched.
      expect(await resolveSellerTaxIdForOrder(container, null, "IN")).toBe(
        "07AAGCJ0494A1ZV"
      )
    })

    it("🔑 relabelling tax_id_type does NOT retire the row — only is_active does", async () => {
      const container = getContainer()
      const service: any = container.resolve(PLATFORM_TAX_IDENTITY_MODULE)
      const row = await brandRow("KHT")

      // The intuitive fix for a row that claims to hold an EU VAT number but
      // holds a company registration number: correct the type.
      await service.updatePlatformTaxIdentities({
        id: row.id,
        tax_id_type: "lv_reg_no",
      })
      expect((await brandRow("KHT"))?.tax_id_type).toBe("lv_reg_no")

      // It changes nothing. `resolvePlatformTaxIdString` returns `tax_id` and
      // never reads the type, so the number keeps reaching carrier labels and
      // customs declarations while the row now merely describes itself honestly.
      expect(await resolveSellerTaxIdForOrder(container, null, "DE")).toBe(
        "40203579735"
      )
    })

    it("is idempotent, and reports an unknown brand rather than failing", async () => {
      const run = (params: Record<string, unknown>) =>
        api.post(
          "/admin/ops/maintenance-jobs/set-platform-tax-identity-active/run",
          { dry_run: false, params },
          adminHeaders
        )

      await run({ brand_code: "KHT", is_active: false })

      const second = await run({ brand_code: "KHT", is_active: false })
      expect(second.data.result.changes).toHaveLength(0)
      expect(second.data.result.applied).toBe(false)
      expect(second.data.result.summary).toMatch(/already/i)

      const missing = await run({ brand_code: "NOPE", is_active: false })
      expect(missing.data.result.changes).toHaveLength(0)
      expect(missing.data.result.summary).toMatch(/No platform tax identity/i)
    })

    it("reactivates, so a future VAT registration needs no new code", async () => {
      await api.post(
        "/admin/ops/maintenance-jobs/set-platform-tax-identity-active/run",
        { dry_run: false, params: { brand_code: "KHT", is_active: false } },
        adminHeaders
      )
      expect((await brandRow("KHT"))?.is_active).toBe(false)

      const res = await api.post(
        "/admin/ops/maintenance-jobs/set-platform-tax-identity-active/run",
        { dry_run: false, params: { brand_code: "KHT", is_active: true } },
        adminHeaders
      )
      expect(res.data.result.applied).toBe(true)
      expect((await brandRow("KHT"))?.is_active).toBe(true)
    })

    it("rejects a missing brand_code with a 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/set-platform-tax-identity-active/run",
          { dry_run: true, params: { is_active: false } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })
})
