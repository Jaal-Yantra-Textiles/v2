import {
  parseDepthInput,
  extractDepthOutput,
} from "../[designId]/segment/depth/depth-image"

describe("parseDepthInput (#337 partner design depth)", () => {
  it("returns url mode when image_url is provided", () => {
    expect(parseDepthInput({ image_url: "https://cdn/x.png" })).toEqual({
      kind: "url",
      imageUrl: "https://cdn/x.png",
    })
  })

  it("prefers image_url over image_base64", () => {
    const out = parseDepthInput({
      image_url: "https://cdn/x.png",
      image_base64: "data:image/png;base64,AAA",
    })
    expect(out).toEqual({ kind: "url", imageUrl: "https://cdn/x.png" })
  })

  it("parses a valid base64 data URL into mime/content/extension", () => {
    expect(
      parseDepthInput({ image_base64: "data:image/jpeg;base64,SGVsbG8=" })
    ).toEqual({
      kind: "base64",
      mimeType: "image/jpeg",
      content: "SGVsbG8=",
      extension: "jpeg",
    })
  })

  it("throws when neither image_url nor image_base64 is provided", () => {
    expect(() => parseDepthInput({})).toThrow(/image_url or image_base64/)
    expect(() => parseDepthInput(null)).toThrow(/image_url or image_base64/)
    expect(() => parseDepthInput(undefined)).toThrow(
      /image_url or image_base64/
    )
  })

  it("throws when image_base64 is not a valid data URL", () => {
    expect(() => parseDepthInput({ image_base64: "not-a-data-url" })).toThrow(
      /valid base64 data URL/
    )
  })
})

describe("extractDepthOutput (#337 partner design depth)", () => {
  it("returns depth + normal urls from a fal MiDaS result", () => {
    const result = {
      data: {
        depth_map: { url: "https://fal/depth.png" },
        normal_map: { url: "https://fal/normal.png" },
      },
    }
    expect(extractDepthOutput(result)).toEqual({
      depth_url: "https://fal/depth.png",
      normal_url: "https://fal/normal.png",
    })
  })

  it("returns normal_url null when fal omits the normal map", () => {
    const result = { data: { depth_map: { url: "https://fal/depth.png" } } }
    expect(extractDepthOutput(result)).toEqual({
      depth_url: "https://fal/depth.png",
      normal_url: null,
    })
  })

  it("throws UNEXPECTED_STATE when fal returned no depth map", () => {
    expect(() => extractDepthOutput({ data: {} })).toThrow(
      /MiDaS returned no depth map/
    )
    expect(() => extractDepthOutput(null)).toThrow(
      /MiDaS returned no depth map/
    )
  })
})
