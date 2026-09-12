import { normalisePostcodeForPacklink } from "../postcode"
import { buildRateQuery } from "../client"

/**
 * The two postcode rules, pinned.
 *
 * Both were found by watching the LIVE API return 400 with a body that says
 * only "Bad Request" — the same body it returns for a missing parameter or an
 * unserved lane. Without these, an EU partner's quotes fail in a way that is
 * indistinguishable from "no carrier serves this route".
 *
 * Evidence (2026-09-12, origin IT 50022, 1 kg / 30×25×10):
 *   NW16XE  -> 400  ·  NW1 6XE -> 200, 8 services
 *   00000   -> 400  ·  1       -> 200, 6 services   (AE)
 */
describe("normalisePostcodeForPacklink", () => {
  describe("GB — the space is load-bearing", () => {
    it("inserts the space before the 3-character inward code", () => {
      expect(normalisePostcodeForPacklink("GB", "NW16XE")).toBe("NW1 6XE")
      expect(normalisePostcodeForPacklink("GB", "SW1A1AA")).toBe("SW1A 1AA")
      expect(normalisePostcodeForPacklink("GB", "M11AE")).toBe("M1 1AE")
    })

    it("rebuilds the space rather than trusting the input's", () => {
      // "NW1  6XE" (double space) and lowercase both have to arrive correct.
      expect(normalisePostcodeForPacklink("GB", "NW1  6XE")).toBe("NW1 6XE")
      expect(normalisePostcodeForPacklink("gb", "nw16xe")).toBe("NW1 6XE")
      expect(normalisePostcodeForPacklink("GB", " NW1 6XE ")).toBe("NW1 6XE")
    })

    it("leaves something too short to split alone rather than mangling it", () => {
      expect(normalisePostcodeForPacklink("GB", "6XE")).toBe("6XE")
      expect(normalisePostcodeForPacklink("GB", "")).toBe("")
    })
  })

  describe("AE — a zero-filled placeholder is refused", () => {
    it("replaces an all-zero or empty postcode with an accepted token", () => {
      expect(normalisePostcodeForPacklink("AE", "00000")).toBe("1")
      expect(normalisePostcodeForPacklink("AE", "0")).toBe("1")
      expect(normalisePostcodeForPacklink("AE", "")).toBe("1")
      expect(normalisePostcodeForPacklink("AE", null)).toBe("1")
    })

    it("keeps a real value the buyer supplied", () => {
      // "Dubai" was verified to work; a buyer's own entry is not overwritten.
      expect(normalisePostcodeForPacklink("AE", "Dubai")).toBe("Dubai")
    })
  })

  it("does not touch countries it has no evidence about", () => {
    // 🔑 This normalises, it does not validate. Inventing a rule for a lane
    // nobody tested would change quotes silently.
    expect(normalisePostcodeForPacklink("IT", "50022")).toBe("50022")
    expect(normalisePostcodeForPacklink("CA", "M5V 3L9")).toBe("M5V 3L9")
    expect(normalisePostcodeForPacklink("CN", "100000")).toBe("100000")
    expect(normalisePostcodeForPacklink("US", "94104")).toBe("94104")
  })
})

describe("buildRateQuery", () => {
  const q = {
    from_country: "it", from_zip: "50022",
    to_country: "gb", to_zip: "NW16XE",
    weight_kg: 1, length_cm: 30, width_cm: 25, height_cm: 10,
  }

  it("uses the bracket notation the API requires, with the postcode fixed", () => {
    const p = buildRateQuery(q)
    expect(p.get("from[country]")).toBe("IT")
    expect(p.get("to[country]")).toBe("GB")
    // The whole reason this module exists:
    expect(p.get("to[zip]")).toBe("NW1 6XE")
    expect(p.get("packages[0][weight]")).toBe("1")
    expect(p.get("packages[0][length]")).toBe("30")
    expect(p.get("source")).toBe("PRO")
  })

  it("encodes the brackets so the URL is the one that returned 200", () => {
    // %5B / %5D — the verified-working request used exactly this encoding.
    expect(buildRateQuery(q).toString()).toContain("packages%5B0%5D%5Bweight%5D=1")
  })
})
