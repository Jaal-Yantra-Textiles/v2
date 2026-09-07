import { derivePartnerHandle, slugifyPartnerName } from "../create-partner-admin"

/**
 * Handle derivation — the behaviour the MCP tool has always advertised and,
 * until the 500s of 2026-09-07, never had. `partner.handle` is a required,
 * unique column; these tests pin what "auto-derived" actually means now that
 * something derives it: `partner_` + the name slug, per the operator's call.
 */
describe("slugifyPartnerName", () => {
  it("lowercases and dash-joins a normal name", () => {
    expect(slugifyPartnerName("JP Handloom")).toBe("jp-handloom")
  })

  it("collapses runs of non-alphanumerics into one dash", () => {
    expect(slugifyPartnerName("JP  Handloom ---  Exporter!!")).toBe(
      "jp-handloom-exporter"
    )
  })

  it("folds accents so an Indian-English name keeps its letters", () => {
    expect(slugifyPartnerName("Chennamangalam Sāri")).toBe("chennamangalam-sari")
  })

  it("trims leading and trailing dashes", () => {
    expect(slugifyPartnerName("-- Kani Weavers --")).toBe("kani-weavers")
  })

  it("caps the slug at 48 characters without a trailing dash", () => {
    const slug = slugifyPartnerName(
      "jp handloom Manufacturer and Exporter of Sustainable Indian Textile and Accessories"
    )
    expect(slug.length).toBeLessThanOrEqual(48)
    expect(slug).not.toMatch(/-$/)
    expect(slug).toBe(
      "jp-handloom-manufacturer-and-exporter-of-sustain"
    )
  })

  it("yields an empty string for a name with nothing slug-able", () => {
    expect(slugifyPartnerName("---")).toBe("")
    expect(slugifyPartnerName("")).toBe("")
  })

  it("survives an undefined-ish name without throwing", () => {
    expect(slugifyPartnerName(undefined as unknown as string)).toBe("")
  })
})

describe("derivePartnerHandle", () => {
  it("prefixes the name slug with partner_", () => {
    expect(derivePartnerHandle("JP Handloom")).toBe("partner_jp-handloom")
  })

  it("falls back to a timestamp suffix when the name has no slug-able characters", () => {
    // The undefined that used to reach the database becomes a handle that is
    // merely ugly — never a 500.
    const handle = derivePartnerHandle("---")
    expect(handle).toMatch(/^partner_[a-z0-9]+$/)
    expect(handle).not.toBe("partner_")
  })

  it("caps long names so the handle stays a handle, not a sentence", () => {
    const handle = derivePartnerHandle(
      "jp handloom Manufacturer and Exporter of Sustainable Indian Textile and Accessories"
    )
    expect(handle.startsWith("partner_jp-handloom")).toBe(true)
    expect(handle.length).toBeLessThanOrEqual(48 + "partner_".length)
    expect(handle).not.toMatch(/-$/)
  })
})
