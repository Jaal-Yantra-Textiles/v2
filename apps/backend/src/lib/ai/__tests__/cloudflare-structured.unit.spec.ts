import {
  isCloudflareAiConfigured,
  readCloudflareResult,
} from "../cloudflare-structured"

describe("isCloudflareAiConfigured", () => {
  it("needs both the account id and the token", () => {
    expect(
      isCloudflareAiConfigured({
        CLOUDFLARE_AI_ACCOUNT_ID: "a",
        CLOUDFLARE_AI_TOKEN: "t",
      } as any)
    ).toBe(true)
    expect(isCloudflareAiConfigured({ CLOUDFLARE_AI_ACCOUNT_ID: "a" } as any)).toBe(false)
    expect(isCloudflareAiConfigured({ CLOUDFLARE_AI_TOKEN: "t" } as any)).toBe(false)
    expect(isCloudflareAiConfigured({} as any)).toBe(false)
  })
})

describe("readCloudflareResult", () => {
  it("reads an already-parsed object out of the envelope", () => {
    expect(
      readCloudflareResult({
        success: true,
        result: { response: { product_type: "trousers", confidence: 0.9 } },
      })
    ).toEqual({ product_type: "trousers", confidence: 0.9 })
  })

  it("reads a JSON STRING response — the other shape the same probe returned", () => {
    // Workers AI hands the answer back either already parsed or as a string
    // depending on the model. Both were seen on one probe run, so both are
    // handled rather than whichever happened to come back first.
    expect(
      readCloudflareResult({
        success: true,
        result: { response: '{"product_type":"saree","confidence":0.98}' },
      })
    ).toEqual({ product_type: "saree", confidence: 0.98 })
  })

  it("handles a result with no `response` wrapper", () => {
    expect(
      readCloudflareResult({ success: true, result: { product_type: "kurta" } })
    ).toEqual({ product_type: "kurta" })
  })

  it("hands back a non-JSON string so the caller's prose parser can try", () => {
    expect(
      readCloudflareResult({ success: true, result: { response: "product_type: stole" } })
    ).toBe("product_type: stole")
  })

  it("returns null on a failed envelope rather than a half-answer", () => {
    expect(readCloudflareResult({ success: false, errors: [{ message: "nope" }] })).toBeNull()
    expect(readCloudflareResult({ success: true, result: null })).toBeNull()
    expect(readCloudflareResult(null)).toBeNull()
    expect(readCloudflareResult("garbage")).toBeNull()
  })
})
