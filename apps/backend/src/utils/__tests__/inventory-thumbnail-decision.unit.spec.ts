import { pickInventoryThumbnail } from "../inventory-thumbnail-decision"

const URL_A = "https://cdn.example.com/a.jpg"
const URL_B = "https://cdn.example.com/b.jpg"

describe("pickInventoryThumbnail", () => {
  it("returns the first media url when the inventory item has no thumbnail", () => {
    expect(pickInventoryThumbnail(null, { files: [URL_A] })).toBe(URL_A)
    expect(pickInventoryThumbnail(undefined, { files: [URL_A, URL_B] })).toBe(
      URL_A
    )
    expect(pickInventoryThumbnail("", [URL_A])).toBe(URL_A)
    expect(pickInventoryThumbnail("   ", [{ url: URL_A }])).toBe(URL_A)
  })

  it("returns undefined when the media blob yields no usable url", () => {
    expect(pickInventoryThumbnail(null, undefined)).toBeUndefined()
    expect(pickInventoryThumbnail(null, { files: [] })).toBeUndefined()
    expect(pickInventoryThumbnail(null, {})).toBeUndefined()
  })

  it("is idempotent — skips when the thumbnail already equals the media url", () => {
    expect(pickInventoryThumbnail(URL_A, { files: [URL_A] })).toBeUndefined()
    // tolerant of surrounding whitespace on the stored thumbnail
    expect(pickInventoryThumbnail(`  ${URL_A}  `, { files: [URL_A] })).toBeUndefined()
  })

  it("does not clobber a different, manually-set thumbnail by default", () => {
    expect(pickInventoryThumbnail(URL_B, { files: [URL_A] })).toBeUndefined()
  })

  it("replaces a different thumbnail only when overwrite is requested", () => {
    expect(
      pickInventoryThumbnail(URL_B, { files: [URL_A] }, { overwrite: true })
    ).toBe(URL_A)
    // still idempotent under overwrite when already equal
    expect(
      pickInventoryThumbnail(URL_A, { files: [URL_A] }, { overwrite: true })
    ).toBeUndefined()
  })
})
