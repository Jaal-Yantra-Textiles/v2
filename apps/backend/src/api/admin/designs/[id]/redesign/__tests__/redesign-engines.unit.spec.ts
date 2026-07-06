/**
 * Unit tests — redesign-engines (#892). Only the pure/parsing surface; the network
 * calls (OpenRouter / Google) are exercised by smoke tests, not here.
 *
 * Run: TEST_TYPE=unit npx jest --testPathPattern="redesign-engines"
 */
import { parseImageToInlineData } from "../redesign-engines"

describe("parseImageToInlineData", () => {
  it("splits a base64 data URL into mimeType + data without a network call", async () => {
    const out = await parseImageToInlineData("data:image/webp;base64,AABBCC")
    expect(out).toEqual({ mimeType: "image/webp", data: "AABBCC" })
  })

  it("throws on a non-base64 data URL", async () => {
    await expect(parseImageToInlineData("data:image/png,notbase64")).rejects.toThrow(
      /valid base64 data URL/
    )
  })
})
