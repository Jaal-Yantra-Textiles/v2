import {
  maskIdNumber,
  normaliseIdCardExtraction,
  parseDateOfBirth,
  personCreateInputFromDraft,
} from "../id-card"

/**
 * The policy half of ID-card onboarding: what survives a vision model's guess.
 *
 * These assert REFUSALS as much as successes. The failure mode that matters
 * here is not "the model misread a card" — it will — but "we wrote the misread
 * down as a fact about a real person, or kept a regulated number we had no
 * business keeping."
 */
const GOOD = {
  first_name: "Lhamo",
  last_name: "Dolkar",
  date_of_birth: "1988-04-11",
  gender: "F",
  id_type: "aadhaar",
  id_number: "1234 5678 9012",
  address: {
    street: "12 Jogiwara Road",
    city: "Dharamshala",
    state: "Himachal Pradesh",
    postal_code: "176219",
    country: "India",
  },
  confidence: 0.93,
}

describe("maskIdNumber", () => {
  it("keeps only the last four digits, ignoring the card's spacing", () => {
    // 🔴 A naive slice(-4) on "1234 5678 9012" is fine, but on "1234 5678 9012 "
    // it is " 012". Separators are stripped before the slice for that reason.
    expect(maskIdNumber("1234 5678 9012", "mask")).toEqual({
      masked: "••••9012",
      last4: "9012",
      warning: null,
    })
    expect(maskIdNumber("1234-5678-9012 ", "mask").last4).toBe("9012")
  })

  it("discards entirely when the policy says so", () => {
    expect(maskIdNumber("1234 5678 9012", "discard")).toEqual({
      masked: null,
      last4: null,
      warning: null,
    })
  })

  it("refuses a number too short to be a document number", () => {
    const r = maskIdNumber("12", "mask")
    expect(r.masked).toBeNull()
    expect(r.warning).toBeTruthy()
  })

  it("never returns the full number in any field", () => {
    const r = maskIdNumber("123456789012", "mask")
    expect(JSON.stringify(r)).not.toContain("123456789012")
  })
})

describe("parseDateOfBirth", () => {
  it("accepts a real ISO date", () => {
    expect(parseDateOfBirth("1988-04-11")).toEqual({
      value: "1988-04-11",
      warning: null,
    })
  })

  it("drops a non-ISO date rather than guessing at it", () => {
    // 11/04/1988 is 11 April or 4 November depending on the country that
    // printed the card. Guessing is how a person gets the wrong birthday.
    const r = parseDateOfBirth("11/04/1988")
    expect(r.value).toBeNull()
    expect(r.warning).toMatch(/not an ISO date/i)
  })

  it("drops a date that rolls over instead of silently moving it", () => {
    // 🔴 new Date("2024-13-45") does not throw — it rolls into the next year.
    // A coerced date is a wrong fact that looks like a right one.
    const r = parseDateOfBirth("2024-13-45")
    expect(r.value).toBeNull()
    expect(r.warning).toMatch(/not a real calendar date/i)
  })

  it("drops a future date", () => {
    expect(parseDateOfBirth("2999-01-01").value).toBeNull()
  })

  it("drops an implausibly distant date as a likely century misread", () => {
    const r = parseDateOfBirth("1788-01-01")
    expect(r.value).toBeNull()
    expect(r.warning).toMatch(/120 years/i)
  })

  it("treats absence as absence, not as an error", () => {
    expect(parseDateOfBirth(null)).toEqual({ value: null, warning: null })
  })
})

describe("normaliseIdCardExtraction", () => {
  it("reads a clean card into a creatable draft", () => {
    const d = normaliseIdCardExtraction(GOOD)

    expect(d.creatable).toBe(true)
    expect(d.first_name).toBe("Lhamo")
    expect(d.last_name).toBe("Dolkar")
    expect(d.date_of_birth).toBe("1988-04-11")
    expect(d.id_type).toBe("aadhaar")
    expect(d.id_last4).toBe("9012")
    expect(d.address?.city).toBe("Dharamshala")
    expect(d.warnings).toEqual([])
  })

  it("🔴 never carries the full ID number into the draft", () => {
    const d = normaliseIdCardExtraction(GOOD)
    // The whole point of the module. A preview response is what an operator
    // pastes into a chat log.
    expect(JSON.stringify(d)).not.toContain("123456789012")
    expect(JSON.stringify(d)).not.toContain("1234 5678 9012")
  })

  it("refuses to make a person out of a card with no name", () => {
    const d = normaliseIdCardExtraction({ ...GOOD, first_name: null, last_name: null })

    expect(d.creatable).toBe(false)
    expect(d.warnings.join(" ")).toMatch(/no name/i)
    expect(() => personCreateInputFromDraft(d)).toThrow(/no name/i)
  })

  it("keeps a single printed name whole rather than inventing a surname", () => {
    const d = normaliseIdCardExtraction({ ...GOOD, first_name: "Tenzin", last_name: null })

    expect(d.creatable).toBe(true)
    expect(d.first_name).toBe("Tenzin")
    expect(d.last_name).toBeNull()
    expect(d.warnings.join(" ")).toMatch(/one name field/i)
  })

  it("warns loudly when the model doubts its own reading", () => {
    const d = normaliseIdCardExtraction({ ...GOOD, confidence: 0.2 })
    expect(d.warnings.join(" ")).toMatch(/confidence/i)
  })

  it("clamps a nonsense confidence instead of trusting it", () => {
    expect(normaliseIdCardExtraction({ ...GOOD, confidence: 42 }).confidence).toBe(1)
    expect(normaliseIdCardExtraction({ ...GOOD, confidence: "abc" }).confidence).toBe(0)
    expect(normaliseIdCardExtraction({ ...GOOD, confidence: -1 }).confidence).toBe(0)
  })

  it("records an unrecognised document type as 'other' and says so", () => {
    const d = normaliseIdCardExtraction({ ...GOOD, id_type: "ration card" })
    expect(d.id_type).toBe("other")
    expect(d.warnings.join(" ")).toMatch(/not one we recognise/i)
  })

  it("treats an all-null address as no address", () => {
    const d = normaliseIdCardExtraction({
      ...GOOD,
      address: { street: null, city: null, state: null, postal_code: null, country: null },
    })
    expect(d.address).toBeNull()
  })

  it("survives junk from the model without throwing", () => {
    for (const junk of [null, undefined, "not json", 42, [], {}]) {
      const d = normaliseIdCardExtraction(junk)
      expect(d.creatable).toBe(false)
      expect(d.confidence).toBe(0)
    }
  })
})

describe("personCreateInputFromDraft", () => {
  it("stamps provenance and marks the document unverified", () => {
    const input = personCreateInputFromDraft(normaliseIdCardExtraction(GOOD), {
      source_image_url: "https://example.com/card.jpg",
    })

    expect(input.first_name).toBe("Lhamo")
    expect(input.date_of_birth).toBeInstanceOf(Date)
    expect(input.metadata.created_via).toBe("id_card_extraction")
    // 🔑 A photo of a card is not proof of anything. Nothing in this pipeline
    // verifies an identity, and the record must not imply that it did.
    expect((input.metadata.id_document as any).verified).toBe(false)
    expect((input.metadata.id_document as any).last4).toBe("9012")
  })

  it("⚠️ leaves email unset rather than inventing one", () => {
    const input = personCreateInputFromDraft(normaliseIdCardExtraction(GOOD))
    // `person.email` is UNIQUE. A synthesised address would collide across
    // cards and poison the constraint for real addresses.
    expect((input as any).email).toBeUndefined()
  })

  it("does not put the full ID number on the person record", () => {
    const input = personCreateInputFromDraft(normaliseIdCardExtraction(GOOD))
    expect(JSON.stringify(input)).not.toContain("123456789012")
  })
})
