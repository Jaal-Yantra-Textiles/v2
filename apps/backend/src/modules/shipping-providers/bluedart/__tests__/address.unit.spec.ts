import {
  blueDartAlnum,
  blueDartReference,
  findBlueDartFieldViolations,
  BLUEDART_TEXT_MAX,
  blueDartDigits,
  blueDartField,
  packBlueDartAddress,
  sanitiseBlueDartText,
} from "../address"

/**
 * Blue Dart caps every name and address line at 30 characters and says nothing
 * when you exceed it — the waybill call returns a bare 400 with an EMPTY body.
 * Both real addresses on order 83 are over the cap, so these are the normal
 * shape of an Indian address, not contrived edge cases.
 */

// The two addresses that actually failed on prod, 2026-08-14.
const ORIGIN_83 = "Ram Nagar Road Sharlho Factory , Ward 11" // 40 chars
const DEST_83 = "A502, Prathna Greens, Sargasan, Gandhinagar" // 43 chars

describe("sanitiseBlueDartText", () => {
  it("drops characters outside the accepted set and collapses the gap", () => {
    // An em dash is the exact character that got `Remarks` rejected live.
    expect(sanitiseBlueDartText("Ward 11 — Block A")).toBe("Ward 11 Block A")
    expect(sanitiseBlueDartText("Café Résidence")).toBe("Caf R sidence")
  })

  it("drops the comma, which the guide leaves ambiguous", () => {
    expect(sanitiseBlueDartText("A502, Prathna Greens")).toBe("A502 Prathna Greens")
  })

  it("keeps the punctuation the guide does list", () => {
    expect(sanitiseBlueDartText("No.12/A (Rear) & Co-op #3")).toBe(
      "No.12/A (Rear) & Co-op #3"
    )
  })

  it("does not truncate — packing decides that", () => {
    expect(sanitiseBlueDartText(ORIGIN_83).length).toBeGreaterThan(BLUEDART_TEXT_MAX)
  })

  it("survives nullish input", () => {
    expect(sanitiseBlueDartText(null)).toBe("")
    expect(sanitiseBlueDartText(undefined)).toBe("")
  })
})

describe("blueDartField", () => {
  it("truncates a name to the 30-character cap", () => {
    const long = "Jaal Yantra Textiles Private Limited"
    expect(blueDartField(long)).toBe("Jaal Yantra Textiles Private L")
    expect(blueDartField(long).length).toBe(BLUEDART_TEXT_MAX)
  })

  it("leaves a short name alone", () => {
    expect(blueDartField("JYT")).toBe("JYT")
  })
})

describe("blueDartDigits", () => {
  it("strips everything that is not a digit — Pincode and Mobile are numeric", () => {
    expect(blueDartDigits("+91 75800-67026", 15)).toBe("917580067026")
    expect(blueDartDigits("176 215", 6)).toBe("176215")
  })

  it("caps to the field width", () => {
    expect(blueDartDigits("1762159999", 6)).toBe("176215")
  })

  it("returns empty for a missing value rather than 'undefined'", () => {
    expect(blueDartDigits(undefined, 6)).toBe("")
    expect(blueDartDigits(null)).toBe("")
  })
})

describe("packBlueDartAddress", () => {
  it("wraps order 83's origin on a word boundary instead of failing", () => {
    const packed = packBlueDartAddress(ORIGIN_83, "Near Nandini Villa")
    expect(packed.line1).toBe("Ram Nagar Road Sharlho Factory")
    expect(packed.line2).toBe("Ward 11 Near Nandini Villa")
    expect(packed.line3).toBe("")
    for (const line of [packed.line1, packed.line2, packed.line3]) {
      expect(line.length).toBeLessThanOrEqual(BLUEDART_TEXT_MAX)
    }
  })

  it("wraps order 83's destination", () => {
    const packed = packBlueDartAddress(DEST_83, "")
    expect(packed.line1).toBe("A502 Prathna Greens Sargasan")
    expect(packed.line2).toBe("Gandhinagar")
    expect(packed.line1.length).toBeLessThanOrEqual(BLUEDART_TEXT_MAX)
  })

  it("never breaks mid-word", () => {
    const packed = packBlueDartAddress(
      "Twentyfour Something Roadway Junction Extension"
    )
    // Rejoining the lines must reproduce the words in order.
    expect(`${packed.line1} ${packed.line2} ${packed.line3}`.trim()).toBe(
      "Twentyfour Something Roadway Junction Extension"
    )
  })

  it("hard-splits a single word longer than a line rather than dropping it", () => {
    const packed = packBlueDartAddress("A".repeat(45))
    expect(packed.line1).toBe("A".repeat(30))
    expect(packed.line2).toBe("A".repeat(15))
  })

  it("discards overflow past the third line — the pincode still routes it", () => {
    const packed = packBlueDartAddress("word ".repeat(60))
    expect(packed.line1.length).toBeLessThanOrEqual(BLUEDART_TEXT_MAX)
    expect(packed.line2.length).toBeLessThanOrEqual(BLUEDART_TEXT_MAX)
    expect(packed.line3.length).toBeLessThanOrEqual(BLUEDART_TEXT_MAX)
  })

  it("returns three empty lines for no address — the blank Shipper case", () => {
    // This is exactly what production sent before `from` was populated, and
    // what Blue Dart answered with an empty-bodied 400.
    expect(packBlueDartAddress(undefined, undefined)).toEqual({
      line1: "",
      line2: "",
      line3: "",
    })
  })

  it("keeps a short address on one line", () => {
    expect(packBlueDartAddress("12 Mall Road", undefined)).toEqual({
      line1: "12 Mall Road",
      line2: "",
      line3: "",
    })
  })
})

describe("blueDartReference", () => {
  it("makes a Medusa order id legal — 32 chars, lowercase and an underscore", () => {
    // Order 83's id. Mandatory field, max 20, A-Z0-9 only: it broke all three
    // rules at once, which is why every waybill the app ever attempted was
    // rejected with an empty 400.
    const ref = blueDartReference("order_01KYPCSTQ783ZT1FKM72VHQABS")
    expect(ref).toMatch(/^[A-Z0-9]{1,20}$/)
    expect(ref.length).toBe(20)
  })

  it("keeps the TAIL, where the entropy is", () => {
    // "ORDER" is constant across every order; truncating from the front would
    // burn a quarter of the budget and make references collide.
    const a = blueDartReference("order_01KYPCSTQ783ZT1FKM72VHQABS")
    const b = blueDartReference("order_01KYPCSTQ783ZT1FKM72VHQZZZ")
    expect(a).not.toBe(b)
  })

  it("leaves an already-legal reference alone", () => {
    expect(blueDartReference("REF123")).toBe("REF123")
  })
})

describe("blueDartAlnum", () => {
  it("strips punctuation a commodity line does not accept", () => {
    expect(blueDartAlnum('Denim Trouser, 32"', 30)).toBe("Denim Trouser 32")
  })
  it("caps to the field width", () => {
    expect(blueDartAlnum("x".repeat(40), 30).length).toBe(30)
  })
})

describe("findBlueDartFieldViolations", () => {
  const ok = {
    Shipper: {
      CustomerName: "JYT",
      CustomerAddress1: "Ram Nagar Road Sharlho Factory",
      CustomerPincode: "176215",
      OriginArea: "DHM",
    },
    Consignee: {
      ConsigneeName: "Chirag Titiya",
      ConsigneeAddress1: "A502 Prathna Greens Sargasan",
      ConsigneePincode: "382421",
    },
    Services: {
      CreditReferenceNo: "3ZT1FKM72VHQABS",
      ProductCode: "D",
      SubProductCode: "",
      SpecialInstruction: "",
    },
  }

  it("passes a request that is within spec", () => {
    expect(findBlueDartFieldViolations(ok)).toEqual([])
  })

  it("catches the blank shipper address that produced the first empty 400", () => {
    const bad = {
      ...ok,
      Shipper: { ...ok.Shipper, CustomerAddress1: "", CustomerPincode: "" },
    }
    const found = findBlueDartFieldViolations(bad)
    expect(found.join(" ")).toContain("Shipper.CustomerAddress1 is mandatory")
    expect(found.join(" ")).toContain("Shipper.CustomerPincode is mandatory")
  })

  it("catches an over-long reference and names the cap", () => {
    const bad = {
      ...ok,
      Services: {
        ...ok.Services,
        CreditReferenceNo: "order_01KYPCSTQ783ZT1FKM72VHQABS",
      },
    }
    const found = findBlueDartFieldViolations(bad)
    expect(found[0]).toContain("Services.CreditReferenceNo is 32 chars, max 20")
  })

  it("catches a multi-character SubProductCode", () => {
    const bad = {
      ...ok,
      Services: { ...ok.Services, SubProductCode: "IPC-Expedited" },
    }
    expect(findBlueDartFieldViolations(bad)[0]).toContain(
      "Services.SubProductCode is 13 chars, max 1"
    )
  })

  it("catches a non-numeric pincode", () => {
    const bad = {
      ...ok,
      Consignee: { ...ok.Consignee, ConsigneePincode: "38242A" },
    }
    expect(findBlueDartFieldViolations(bad)[0]).toContain(
      "Consignee.ConsigneePincode does not match"
    )
  })
})
