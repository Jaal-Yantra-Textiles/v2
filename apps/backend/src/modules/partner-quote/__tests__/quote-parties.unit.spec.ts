import {
  composeBuyerParty,
  composeSellerParty,
  normaliseTaxId,
} from "../lib/quote-parties"

/**
 * The parties on a quote document.
 *
 * 🔴 The assertion that matters is that the platform identity is chosen by the
 * ORIGIN. Resolving a seller from the consignee's country is the #348 defect
 * (a Latvian company number on an India-origin customs declaration) and the
 * #1447 defect (19% German VAT on an Indian export). Both produced a
 * well-formed document that was wrong, and both passed every test that only
 * asserted a value came back.
 */

const JYT = {
  id: "pti_jyt",
  brand_code: "JYT",
  legal_name: "Jaal Yantra Textiles",
  tax_id: "07AABCU9603R1ZM",
  tax_id_type: "gstin",
  country_codes: ["IN"],
  is_active: true,
}

describe("normaliseTaxId", () => {
  it("uppercases and strips whitespace so two spellings compare equal", () => {
    expect(normaliseTaxId("de 123 456 789")).toBe("DE123456789")
    expect(normaliseTaxId("DE123456789")).toBe("DE123456789")
  })

  it("KEEPS punctuation — deleting it would store a different number", () => {
    // Several schemes carry meaningful characters. Silently dropping them
    // stores a registration the buyer does not hold.
    expect(normaliseTaxId("ab-1234/x")).toBe("AB-1234/X")
  })

  it("treats blank as absent, never as an empty registration", () => {
    expect(normaliseTaxId("   ")).toBeNull()
    expect(normaliseTaxId(null)).toBeNull()
    expect(normaliseTaxId(undefined)).toBeNull()
  })
})

describe("composeSellerParty", () => {
  it("prefers the partner's OWN registration", () => {
    const seller = composeSellerParty({
      partner: { name: "Unique Pashmina", tax_id: "01ABCDE1234F1Z5", tax_id_type: "gstin" },
      platform: JYT,
      origin_country_code: "in",
    })

    expect(seller.source).toBe("partner")
    expect(seller.legal_name).toBe("Unique Pashmina")
    expect(seller.tax_id).toBe("01ABCDE1234F1Z5")
    expect(seller.origin_country_code).toBe("IN")
  })

  it("falls back to the platform identity for the origin country", () => {
    const seller = composeSellerParty({
      partner: { name: "Unique Pashmina", tax_id: null, tax_id_type: null },
      platform: JYT,
      origin_country_code: "IN",
    })

    expect(seller.source).toBe("platform")
    expect(seller.legal_name).toBe("Jaal Yantra Textiles")
    expect(seller.tax_id).toBe("07AABCU9603R1ZM")
  })

  it("🔑 names the seller even with no registration at all", () => {
    // "Who is selling" and "under which registration" are two facts, and the
    // first is still true when the second is missing.
    const seller = composeSellerParty({
      partner: { name: "Unique Pashmina", tax_id: "  ", tax_id_type: null },
      platform: null,
      origin_country_code: "IN",
    })

    expect(seller.legal_name).toBe("Unique Pashmina")
    expect(seller.tax_id).toBeNull()
    expect(seller.source).toBeNull()
  })

  it("normalises a partner registration written with spaces", () => {
    expect(
      composeSellerParty({
        partner: { name: "P", tax_id: "01 ABCDE 1234 F1Z5", tax_id_type: "gstin" },
        origin_country_code: "IN",
      }).tax_id
    ).toBe("01ABCDE1234F1Z5")
  })
})

describe("composeBuyerParty", () => {
  it("carries the buyer's stated registration", () => {
    const buyer = composeBuyerParty({
      recipient_company: "Weber Textil GmbH",
      recipient_name: "Anja Weber",
      buyer_tax_id: "DE123456789",
      buyer_tax_id_type: "eu_vat",
    })

    expect(buyer.company).toBe("Weber Textil GmbH")
    expect(buyer.tax_id).toBe("DE123456789")
    expect(buyer.tax_id_type).toBe("eu_vat")
  })

  it("🔴 NEVER reports the buyer's number as verified", () => {
    // Nothing checks this against VIES or the GST portal. A renderer that could
    // read a stored number as a checked one would invite a reverse-charge
    // assumption nobody is entitled to make — and KHT Latvia is not even
    // VAT-registered, so that assumption has no route to being true.
    expect(
      composeBuyerParty({ buyer_tax_id: "DE123456789", buyer_tax_id_type: "eu_vat" })
        .tax_id_verified
    ).toBe(false)
  })

  it("reports an absent registration as null, not as an empty string", () => {
    const buyer = composeBuyerParty({ recipient_company: "X" })
    expect(buyer.tax_id).toBeNull()
    expect(buyer.tax_id_type).toBeNull()
  })
})
