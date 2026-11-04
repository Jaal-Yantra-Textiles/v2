import { designLinesFromItems, isPreviewLinkUsable } from "../design-preview-links"

describe("isPreviewLinkUsable", () => {
  const now = new Date("2026-11-04T10:00:00Z")

  it("is usable with no expiry and no revocation", () => {
    expect(isPreviewLinkUsable({}, now)).toBe(true)
  })

  it("is not usable once revoked", () => {
    expect(isPreviewLinkUsable({ revoked_at: "2026-11-04T09:00:00Z" }, now)).toBe(false)
  })

  it("is not usable at or after expiry, usable before it", () => {
    expect(isPreviewLinkUsable({ expires_at: "2026-11-04T10:00:00Z" }, now)).toBe(false)
    expect(isPreviewLinkUsable({ expires_at: "2026-11-05T10:00:00Z" }, now)).toBe(true)
  })
})

describe("designLinesFromItems", () => {
  it("keeps line order, drops lines with no design, reads the column or metadata", () => {
    expect(
      designLinesFromItems([
        { design_id: "d1", quantity: 10 },
        { design_id: null, quantity: 1 },
        { metadata: { design_id: "d2" }, quantity: "2" },
      ])
    ).toEqual([
      { design_id: "d1", quantity: 10 },
      { design_id: "d2", quantity: 2 },
    ])
  })

  it("lists a design on two lines once, quantities added", () => {
    expect(
      designLinesFromItems([
        { design_id: "d1", quantity: 2 },
        { design_id: "d1", quantity: 3 },
      ])
    ).toEqual([{ design_id: "d1", quantity: 5 }])
  })

  it("is empty for no items", () => {
    expect(designLinesFromItems(null)).toEqual([])
  })
})
