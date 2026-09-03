/**
 * #1759 — the reference-upload path must not corrupt image bytes.
 *
 * The route used to pass `file.buffer.toString("binary")` (latin1) into
 * `uploadFilesWorkflow`. The Medusa file provider (local-file / file-s3)
 * format-detects the content string by attempting a base64 round-trip; a
 * latin1 string of raw bytes fails that check, so the provider falls back to
 * `Buffer.from(content, "utf8")`, which UTF-8-re-encodes every byte >= 0x80.
 * The upload still SUCCEEDS — a 200 with a mojibake file on the other end
 * (magic bytes c3 bf c3 98 instead of ff d8 ff e0, browsers refuse to
 * render). So a test that only asserts the route responds proves nothing:
 * byte-identity of the round-trip is the only evidence that counts.
 *
 * The admin media routes were fixed the same way in #769; this spec pins the
 * store route to the same base64 encoding.
 */
import { createHash } from "crypto"

import { encodeUploadContent } from "../route"

const sha256 = (buf: Buffer): string =>
  createHash("sha256").update(buf).digest("hex")

/**
 * A fixture with the mess of a real image: JPEG magic bytes up front, then
 * every byte value 0x00–0xff once — 132 of the 260 bytes are >= 0x80, the
 * exact range latin1 + the utf8 fallback corrupts. Length 260 is not a
 * multiple of 3, so base64 padding is exercised too.
 */
const imageLike = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, // JPEG magic (SOI + APP0 marker)
  ...Array.from({ length: 256 }, (_, i) => i),
])

describe("encodeUploadContent (#1759)", () => {
  it("round-trips every byte 0x00–0xff byte-identically", () => {
    const encoded = encodeUploadContent(imageLike)
    const decoded = Buffer.from(encoded, "base64")

    expect(decoded.length).toBe(imageLike.length)
    expect(sha256(decoded)).toBe(sha256(imageLike))
  })

  it("survives the file provider's base64 round-trip detection", () => {
    // The provider only decodes content as base64 when the string re-encodes
    // to itself; anything else takes the utf8 fallback and is corrupted.
    const encoded = encodeUploadContent(imageLike)
    expect(Buffer.from(encoded, "base64").toString("base64")).toBe(encoded)
  })

  it("round-trips a single 0xff byte (base64 padding edge)", () => {
    const source = Buffer.from([0xff])
    const decoded = Buffer.from(encodeUploadContent(source), "base64")

    expect(decoded.length).toBe(1)
    expect(sha256(decoded)).toBe(sha256(source))
  })

  /**
   * The encoding this route used before #1759. Not the code under test —
   * the documented failure mode it must never regress to: latin1 fails the
   * provider's detection, and the utf8 fallback re-encodes every high byte.
   */
  it("proves the old latin1 encoding corrupts (the bug this fixes)", () => {
    const latin1 = imageLike.toString("binary")

    // Fails the provider's base64 detection → takes the utf8 fallback.
    expect(Buffer.from(latin1, "base64").toString("base64")).not.toBe(latin1)

    // And the utf8 fallback re-encodes: the 4 magic bytes + 128 high bytes
    // each become two UTF-8 bytes → 392 bytes where 260 went in.
    const utf8 = Buffer.from(latin1, "utf8")
    expect(utf8.length).toBe(392)
    expect(sha256(utf8)).not.toBe(sha256(imageLike))
  })
})
