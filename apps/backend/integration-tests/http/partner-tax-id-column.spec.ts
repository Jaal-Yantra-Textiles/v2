import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { resolvePartnerTaxId } from "../../src/modules/partner/tax-id-lib"

jest.setTimeout(60 * 1000)

/**
 * Issue #348 — verifies the partner `tax_id` / `tax_id_type` typed columns are
 * wired (model + migration) and persist, and that the pure fallback resolver
 * behaves end-to-end against a real partner row.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  it("persists tax_id / tax_id_type on the partner typed columns", async () => {
    const container = getContainer()
    const partnerService: any = container.resolve("partner")

    const unique = Date.now() + Math.random().toString(36).slice(2, 6)

    // Partner WITH its own tax ID
    const withTaxId = await partnerService.createPartners({
      name: `TaxCol ${unique}`,
      handle: `taxcol-${unique}`,
      tax_id: "29ABCDE1234F1Z5",
      tax_id_type: "GSTIN",
    })
    const reloaded = await partnerService.retrievePartner(withTaxId.id)
    expect(reloaded.tax_id).toBe("29ABCDE1234F1Z5")
    expect(reloaded.tax_id_type).toBe("GSTIN")

    // Resolver prefers the partner's own ID
    const partnerResolved = resolvePartnerTaxId({
      partnerTaxId: reloaded.tax_id,
      partnerTaxIdType: reloaded.tax_id_type,
      brand: "JYT",
      platformTaxIds: { JYT: "JYT-PLATFORM-GST" },
    })
    expect(partnerResolved.source).toBe("partner")
    expect(partnerResolved.taxId).toBe("29ABCDE1234F1Z5")

    // Partner WITHOUT a tax ID — column defaults to null
    const withoutTaxId = await partnerService.createPartners({
      name: `TaxColNone ${unique}`,
      handle: `taxcolnone-${unique}`,
    })
    const reloadedNone = await partnerService.retrievePartner(withoutTaxId.id)
    expect(reloadedNone.tax_id ?? null).toBeNull()

    // Resolver falls back to the platform brand ID
    const platformResolved = resolvePartnerTaxId({
      partnerTaxId: reloadedNone.tax_id,
      brand: "KHT",
      platformTaxIds: { KHT: "KHT-PLATFORM-GST" },
    })
    expect(platformResolved.source).toBe("platform")
    expect(platformResolved.taxId).toBe("KHT-PLATFORM-GST")
  })
})
