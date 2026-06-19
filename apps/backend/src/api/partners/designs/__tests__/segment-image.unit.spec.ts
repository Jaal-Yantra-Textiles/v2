import {
  parseSegmentInput,
  extractSegmentOutput,
} from "../[designId]/segment/segment-image"

describe("parseSegmentInput (#337 partner design segment)", () => {
  it("returns url mode when image_url is provided", () => {
    expect(
      parseSegmentInput({ image_url: "https://cdn/x.png" })
    ).toEqual({ kind: "url", imageUrl: "https://cdn/x.png" })
  })

  it("prefers image_url over image_base64", () => {
    const out = parseSegmentInput({
      image_url: "https://cdn/x.png",
      image_base64: "data:image/png;base64,AAA",
    })
    expect(out).toEqual({ kind: "url", imageUrl: "https://cdn/x.png" })
  })

  it("parses a valid base64 data URL into mime/content/extension", () => {
    expect(
      parseSegmentInput({ image_base64: "data:image/jpeg;base64,SGVsbG8=" })
    ).toEqual({
      kind: "base64",
      mimeType: "image/jpeg",
      content: "SGVsbG8=",
      extension: "jpeg",
    })
  })

  it("throws when neither image_url nor image_base64 is provided", () => {
    expect(() => parseSegmentInput({})).toThrow(/image_url or image_base64/)
    expect(() => parseSegmentInput(null)).toThrow(/image_url or image_base64/)
    expect(() => parseSegmentInput(undefined)).toThrow(
      /image_url or image_base64/
    )
  })

  it("throws when image_base64 is not a valid data URL", () => {
    expect(() =>
      parseSegmentInput({ image_base64: "not-a-data-url" })
    ).toThrow(/valid base64 data URL/)
  })
})

describe("extractSegmentOutput (#337 partner design segment)", () => {
  it("returns cutout + mask urls from a fal result", () => {
    const result = {
      data: {
        image: { url: "https://fal/cutout.png" },
        mask_image: { url: "https://fal/mask.png" },
      },
    }
    expect(extractSegmentOutput(result)).toEqual({
      cutout_url: "https://fal/cutout.png",
      mask_url: "https://fal/mask.png",
    })
  })

  it("returns mask_url null when fal omits the mask", () => {
    const result = { data: { image: { url: "https://fal/cutout.png" } } }
    expect(extractSegmentOutput(result)).toEqual({
      cutout_url: "https://fal/cutout.png",
      mask_url: null,
    })
  })

  it("throws UNEXPECTED_STATE when fal returned no cutout image", () => {
    expect(() => extractSegmentOutput({ data: {} })).toThrow(
      /BiRefNet returned no image/
    )
    expect(() => extractSegmentOutput(null)).toThrow(
      /BiRefNet returned no image/
    )
  })
})
