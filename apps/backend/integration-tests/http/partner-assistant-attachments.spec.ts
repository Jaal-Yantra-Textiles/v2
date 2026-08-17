/**
 * POST /partners/assistant/attachments — photos shared with the partner
 * assistant.
 *
 * The pre-existing `/partners/medias/uploads/*` pair puts objects at the bucket
 * ROOT and writes no media record at all, so an uploaded photo becomes
 * unattributable the moment the chat ends. These tests pin the properties that
 * fix is made of: a real media row, in a folder owned by the uploading partner,
 * reused across uploads, with the bytes intact.
 */
import fs from "fs"
import path from "path"
import FormData from "form-data"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { MEDIA_MODULE } from "../../src/modules/media"
import { assistantFolderSlug } from "../../src/api/partners/assistant/attachments/folder-naming"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner assistant attachments", () => {
    let partnerHeaders: Record<string, string>
    let partnerId: string
    let partnerName: string

    /** A real JPEG whose body walks every byte 0x00-0xFF, so any latin1/UTF-8
     *  round trip (#769) changes its length and magic bytes. */
    const buildBinaryImage = (): Buffer => {
      const body: number[] = []
      for (let rep = 0; rep < 4; rep++) {
        for (let b = 0; b <= 255; b++) body.push(b)
      }
      return Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from(body),
        Buffer.from([0xff, 0xd9]),
      ])
    }

    const readStoredFile = (filePath: string): Buffer | null => {
      const marker = "/static/"
      const idx = filePath.indexOf(marker)
      if (idx === -1) return null
      const key = decodeURIComponent(filePath.slice(idx + marker.length))
      const onDisk = path.join(process.cwd(), "static", key)
      return fs.existsSync(onDisk) ? fs.readFileSync(onDisk) : null
    }

    const upload = async (
      files: Array<{ buf: Buffer; filename: string; contentType: string }>,
      conversationId?: string
    ) => {
      const form = new FormData()
      for (const f of files) {
        form.append("files", f.buf, {
          filename: f.filename,
          contentType: f.contentType,
        })
      }
      if (conversationId) form.append("conversation_id", conversationId)
      return api.post("/partners/assistant/attachments", form, {
        headers: { ...partnerHeaders, ...form.getHeaders() },
      })
    }

    /** axios rejects on 4xx, so error responses have to be unwrapped rather
     *  than returned — without this a correct 400 reads as a test failure. */
    const expectFailure = async (fn: () => Promise<any>) => {
      try {
        const res = await fn()
        throw new Error(
          `Expected the request to fail, but it returned ${res.status}`
        )
      } catch (e: any) {
        if (!e?.response) throw e
        return e.response
      }
    }

    beforeEach(async () => {
      const unique = Date.now()
      const partnerEmail = `partner-att-${unique}@medusa-test.com`
      partnerName = `Pashmina Att ${unique}`

      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

      const partnerRes = await api.post(
        "/partners",
        {
          name: partnerName,
          handle: `pashmina-att-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Admin",
            last_name: "Att",
          },
        },
        { headers: partnerHeaders }
      )
      partnerId = partnerRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }
    })

    it("stores each photo as a media record inside a folder owned by the partner", async () => {
      const res = await upload(
        [
          { buf: buildBinaryImage(), filename: "shawl-1.jpg", contentType: "image/jpeg" },
          { buf: buildBinaryImage(), filename: "shawl-2.jpg", contentType: "image/jpeg" },
        ],
        "chat_abc"
      )

      expect(res.status).toBe(201)
      expect(res.data.attachments).toHaveLength(2)
      for (const a of res.data.attachments) {
        expect(a.url).toBeTruthy()
        expect(a.media_id).toBeTruthy()
        expect(a.type).toBe("image/jpeg")
      }

      const mediaService: any = getContainer().resolve(MEDIA_MODULE)
      const folders = await mediaService.listFolders({
        slug: assistantFolderSlug(partnerId),
      })
      expect(folders).toHaveLength(1)
      expect(folders[0].id).toBe(res.data.folder_id)
      expect(folders[0].name).toContain(partnerName)
      expect(folders[0].metadata?.partner_id).toBe(partnerId)

      // The media rows live IN that folder — this is the whole difference from
      // the bucket-root path, so assert the link rather than just the row.
      const files = await mediaService.listMediaFiles({
        folder_id: folders[0].id,
      })
      expect(files).toHaveLength(2)
      for (const f of files) {
        expect(f.metadata?.uploaded_by_partner_id).toBe(partnerId)
        expect(f.metadata?.conversation_id).toBe("chat_abc")
        expect(f.metadata?.source).toBe("partner_assistant")
      }
    })

    it("keeps the image bytes intact", async () => {
      // #769: content passed as latin1 rather than base64 is UTF-8 re-encoded,
      // inflating the file ~1.5x and rewriting the magic bytes — the image
      // uploads "successfully" and no vision model can read it.
      const original = buildBinaryImage()
      const res = await upload(
        [{ buf: original, filename: "integrity.jpg", contentType: "image/jpeg" }],
        "chat_bytes"
      )
      expect(res.status).toBe(201)

      const stored = readStoredFile(res.data.attachments[0].url)
      expect(stored).not.toBeNull()
      expect(stored!.length).toBe(original.length)
      expect(stored!.equals(original)).toBe(true)
    })

    it("reuses the same folder across separate uploads", async () => {
      // Photos arrive a few at a time across several messages. Each batch must
      // land in the SAME folder — a per-upload folder would scatter one
      // conversation's photos across many.
      const first = await upload(
        [{ buf: buildBinaryImage(), filename: "a.jpg", contentType: "image/jpeg" }],
        "chat_same"
      )
      const second = await upload(
        [{ buf: buildBinaryImage(), filename: "b.jpg", contentType: "image/jpeg" }],
        "chat_same"
      )

      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      expect(second.data.folder_id).toBe(first.data.folder_id)

      const mediaService: any = getContainer().resolve(MEDIA_MODULE)
      const folders = await mediaService.listFolders({
        slug: assistantFolderSlug(partnerId),
      })
      expect(folders).toHaveLength(1)

      const files = await mediaService.listMediaFiles({
        folder_id: first.data.folder_id,
      })
      expect(files).toHaveLength(2)
    })

    it("refuses non-image uploads instead of attaching something unreadable", async () => {
      const res = await expectFailure(() =>
        upload(
          [
            {
              buf: Buffer.from("not an image"),
              filename: "notes.txt",
              contentType: "text/plain",
            },
          ],
          "chat_bad"
        )
      )
      expect(res.status).toBe(400)
      expect(String(res.data.message)).toMatch(/only image uploads/i)

      // Nothing was stored — a rejected batch must not leave a half-written
      // folder or an orphan media row behind.
      const mediaService: any = getContainer().resolve(MEDIA_MODULE)
      const folders = await mediaService.listFolders({
        slug: assistantFolderSlug(partnerId),
      })
      if (folders.length) {
        const files = await mediaService.listMediaFiles({
          folder_id: folders[0].id,
        })
        expect(files).toHaveLength(0)
      }
    })

    it("rejects an unauthenticated upload", async () => {
      const form = new FormData()
      form.append("files", buildBinaryImage(), {
        filename: "x.jpg",
        contentType: "image/jpeg",
      })
      const res = await expectFailure(() =>
        api.post("/partners/assistant/attachments", form, {
          headers: form.getHeaders(),
        })
      )
      expect([401, 403]).toContain(res.status)
    })
  })
})
