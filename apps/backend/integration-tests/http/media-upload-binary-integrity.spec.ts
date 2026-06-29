import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import FormData from "form-data";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";
import fs from "fs";
import path from "path";

jest.setTimeout(30000);

/**
 * Regression guard for #769: POST /admin/medias must store binary uploads
 * byte-for-byte.
 *
 * The bug: the route serialized file content with `buffer.toString("binary")`
 * (Latin-1). The Medusa file provider (local-file / file-s3) format-detects the
 * content string by attempting a base64 round-trip and, when that fails, falls
 * back to `Buffer.from(content, "utf8")` — which UTF-8-re-encodes every byte
 * >= 0x80. A real JPEG (`FF D8 FF E0 …`) thus landed on disk as mojibake
 * (`C3 BF C3 98 …`), ~1.5x larger and unreadable by any image decoder, which is
 * why import-from-image failed with "cannot identify image file". The fix sends
 * base64 so the provider takes the lossless decode branch.
 *
 * The pre-existing media-upload tests only used ASCII text ("This is test
 * image content"), whose bytes are all < 0x80 — so they never exercised the
 * corrupting path. These tests deliberately use bytes >= 0x80.
 */
setupSharedTestSuite(() => {
  let headers;
  const { api, getContainer } = getSharedTestEnv();

  beforeEach(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);
  });

  // Build a deterministic "image" that contains every byte value 0x00-0xFF
  // (so it includes the >= 0x80 bytes that trigger the bug), framed with JPEG
  // SOI/EOI markers so a successful round-trip is also recognizable.
  const buildBinaryImage = (): Buffer => {
    const body: number[] = []
    for (let rep = 0; rep < 8; rep++) {
      for (let b = 0; b <= 255; b++) body.push(b)
    }
    return Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]), // JPEG SOI + APP0
      Buffer.from(body),
      Buffer.from([0xff, 0xd9]), // JPEG EOI
    ])
  }

  // Resolve the on-disk path the local file provider wrote to from the public
  // file_path URL (…/static/<key>). The default provider stores under
  // `${cwd}/static`.
  const readStoredFile = (filePath: string): Buffer | null => {
    const marker = "/static/"
    const idx = filePath.indexOf(marker)
    if (idx === -1) return null
    const key = decodeURIComponent(filePath.slice(idx + marker.length))
    const onDisk = path.join(process.cwd(), "static", key)
    return fs.existsSync(onDisk) ? fs.readFileSync(onDisk) : null
  }

  const uploadOne = async (buf: Buffer, filename: string) => {
    const formData = new FormData()
    formData.append("files", buf, { filename, contentType: "image/jpeg" })
    const formHeaders = formData.getHeaders()
    const response = await api.post("/admin/medias", formData, {
      ...headers,
      headers: { ...headers.headers, ...formHeaders },
    })
    return response
  }

  describe("POST /admin/medias — binary integrity (#769)", () => {
    it("stores a binary image byte-for-byte (no Latin-1 -> UTF-8 corruption)", async () => {
      const original = buildBinaryImage()

      const response = await uploadOne(original, "binary-int.jpg")
      expect(response.status).toBe(201)
      const media = response.data.result.mediaFiles[0]
      expect(media).toBeTruthy()
      expect(media.file_path).toBeTruthy()

      const stored = readStoredFile(media.file_path)
      // If the provider isn't the local disk provider in this env, we can't read
      // it back — fail loudly rather than silently passing.
      expect(stored).not.toBeNull()

      // The corruption inflates size (~1.5x) and rewrites the magic bytes.
      expect(stored!.length).toBe(original.length)
      expect(stored!.equals(original)).toBe(true)
      // Magic bytes survive intact (would be C3 BF C3 98 if corrupted).
      expect(stored!.subarray(0, 4).toString("hex")).toBe("ffd8ffe0")
      expect(stored!.subarray(-2).toString("hex")).toBe("ffd9")
    })

    it("does NOT exhibit the latin1->utf8 mojibake signature", async () => {
      // A pure high-byte payload: every byte is 0xFF, which UTF-8 encoding would
      // double to C3 BF … doubling the length. Byte-exact + length-exact proves
      // the lossless path.
      const original = Buffer.alloc(2048, 0xff)

      const response = await uploadOne(original, "high-bytes.bin")
      expect(response.status).toBe(201)
      const media = response.data.result.mediaFiles[0]
      const stored = readStoredFile(media.file_path)
      expect(stored).not.toBeNull()

      expect(stored!.length).toBe(original.length) // corruption would be ~4096
      expect(stored!.equals(original)).toBe(true)
      // Explicitly assert the corruption signature is absent.
      expect(stored!.subarray(0, 2).toString("hex")).not.toBe("c3bf")
    })

    it("still stores plain ASCII text uploads correctly (no regression)", async () => {
      const original = Buffer.from("This is plain ascii content", "utf-8")

      const response = await uploadOne(original, "ascii.txt")
      expect(response.status).toBe(201)
      const media = response.data.result.mediaFiles[0]
      const stored = readStoredFile(media.file_path)
      expect(stored).not.toBeNull()
      expect(stored!.equals(original)).toBe(true)
    })
  })
})
