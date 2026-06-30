import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import * as fs from "fs"
import * as path from "path"
import FormData from "form-data"

jest.setTimeout(60000) // 1 minute timeout

const findSampleImagePath = (): string | null => {
  const imgPathCandidates = [
    path.join(__dirname, "../assets/textile-sample.jpg"),
    path.join(__dirname, "../assets/textile-sample.jpeg"),
    path.join(__dirname, "../assets/textile-sample.png"),
    path.join(__dirname, "../assets/sample-image.jpg"),
  ]
  for (const p of imgPathCandidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  describe("POST /admin/medias/extract-features - Textile Product Extraction", () => {
    it("should initiate textile extraction and return transaction_id", async () => {
      const imgPath = findSampleImagePath()
      if (!imgPath) {
        console.warn("Skipping local image test: sample image not found")
        return
      }

      // 1) Upload media via media API
      const fileBuf = fs.readFileSync(imgPath)
      const formData = new FormData()
      const ext = path.extname(imgPath).toLowerCase()
      const contentType =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : "application/octet-stream"
      formData.append("files", fileBuf, {
        filename: path.basename(imgPath),
        contentType,
      })

      const formHeaders = formData.getHeaders()
      const uploadRes = await api.post("/admin/medias", formData, {
        ...headers,
        headers: {
          ...headers.headers,
          ...formHeaders,
        },
      })
      expect(uploadRes.status).toBe(201)
      const mediaFiles = uploadRes.data?.result?.mediaFiles || []
      expect(Array.isArray(mediaFiles) && mediaFiles.length > 0).toBe(true)
      const media = mediaFiles[0]

      // 2) Trigger textile extraction
      const extractRes = await api.post(
        "/admin/medias/extract-features",
        {
          media_id: media.id,
          hints: ["focus on fabric type and pattern"],
          persist: false,
        },
        headers
      )

      // Should return 202 Accepted with transaction_id
      expect(extractRes.status).toBe(202)
      expect(extractRes.data.transaction_id).toBeDefined()
      expect(extractRes.data.status).toBe("pending_confirmation")
      expect(extractRes.data.message).toContain("Confirm to start processing")

      console.log(
        "Textile extraction initiated with transaction_id:",
        extractRes.data.transaction_id
      )

      // 3) Confirm the workflow to prevent test runner from waiting indefinitely
      // This is required because the test runner waits for all workflow executions to finish
      const transactionId = extractRes.data.transaction_id
      await api.post(
        `/admin/medias/extract-features/${transactionId}/confirm`,
        {},
        headers
      )
      console.log("Workflow confirmed to allow test completion")
    })

    it("should confirm extraction and process in background", async () => {
      const imgPath = findSampleImagePath()
      if (!imgPath) {
        console.warn("Skipping confirm test: sample image not found")
        return
      }

      // 1) Upload media
      const fileBuf = fs.readFileSync(imgPath)
      const formData = new FormData()
      const ext = path.extname(imgPath).toLowerCase()
      const contentType =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : "application/octet-stream"
      formData.append("files", fileBuf, {
        filename: path.basename(imgPath),
        contentType,
      })

      const formHeaders = formData.getHeaders()
      const uploadRes = await api.post("/admin/medias", formData, {
        ...headers,
        headers: {
          ...headers.headers,
          ...formHeaders,
        },
      })
      expect(uploadRes.status).toBe(201)
      const media = uploadRes.data?.result?.mediaFiles?.[0]
      expect(media).toBeDefined()

      // 2) Trigger extraction
      const extractRes = await api.post(
        "/admin/medias/extract-features",
        {
          media_id: media.id,
          hints: ["analyze textile patterns"],
          persist: false,
        },
        headers
      )
      expect(extractRes.status).toBe(202)
      const transactionId = extractRes.data.transaction_id
      expect(transactionId).toBeDefined()
      console.log("Transaction ID:", transactionId)

      // 3) Confirm extraction to start processing
      const confirmRes = await api.post(
        `/admin/medias/extract-features/${transactionId}/confirm`,
        {},
        headers
      )

      // Should return 200 with success
      expect(confirmRes.status).toBe(200)
      expect(confirmRes.data.success).toBe(true)
      expect(confirmRes.data.message).toContain("confirmed")

      console.log("Extraction confirmed and processing started in background")

      // Note: Background processing will continue asynchronously
      // For full end-to-end testing of results, add a longer wait and check media metadata
    })

    it("should process multiple images and return transaction IDs", async () => {
      const imgPath = findSampleImagePath()
      if (!imgPath) {
        console.warn("Skipping multi-image test: sample image not found")
        return
      }

      const transactionIds: string[] = []

      // Upload and trigger extraction for 2 images
      for (let i = 0; i < 2; i++) {
        // Upload media
        const fileBuf = fs.readFileSync(imgPath)
        const formData = new FormData()
        formData.append("files", fileBuf, {
          filename: `textile-test-${i}.jpg`,
          contentType: "image/jpeg",
        })

        const formHeaders = formData.getHeaders()
        const uploadRes = await api.post("/admin/medias", formData, {
          ...headers,
          headers: {
            ...headers.headers,
            ...formHeaders,
          },
        })
        expect(uploadRes.status).toBe(201)
        const media = uploadRes.data?.result?.mediaFiles?.[0]
        expect(media).toBeDefined()

        // Trigger extraction
        const extractRes = await api.post(
          "/admin/medias/extract-features",
          {
            media_id: media.id,
            hints: [`Image ${i + 1}: extract textile features`],
            persist: false,
          },
          headers
        )
        expect(extractRes.status).toBe(202)
        expect(extractRes.data.transaction_id).toBeDefined()
        transactionIds.push(extractRes.data.transaction_id)
        console.log(`Image ${i + 1} extraction initiated: ${extractRes.data.transaction_id}`)
      }

      // Verify we have 2 unique transaction IDs
      expect(transactionIds.length).toBe(2)
      expect(new Set(transactionIds).size).toBe(2) // All unique

      console.log(`Successfully initiated extraction for ${transactionIds.length} images`)

      // Confirm all workflows to prevent test runner from waiting indefinitely
      for (const transactionId of transactionIds) {
        await api.post(
          `/admin/medias/extract-features/${transactionId}/confirm`,
          {},
          headers
        )
      }
      console.log("All workflows confirmed to allow test completion")
    })

    it("should reject extraction for non-existent media", async () => {
      // Try to extract features from non-existent media
      try {
        await api.post(
          "/admin/medias/extract-features",
          {
            media_id: "non-existent-media-id",
            persist: false,
          },
          headers
        )
        fail("Should have thrown an error for non-existent media")
      } catch (error: any) {
        expect(error.response?.status).toBe(404)
        console.log("Correctly rejected non-existent media with 404")
      }
    })

    it("should validate required fields", async () => {
      // Try to extract without media_id
      try {
        await api.post(
          "/admin/medias/extract-features",
          {
            hints: ["test"],
          },
          headers
        )
        fail("Should have thrown validation error")
      } catch (error: any) {
        expect([400, 422]).toContain(error.response?.status)
        console.log("Correctly validated missing media_id")
      }
    })
  })

  describe("GET /admin/medias - File Type Search Enhancement", () => {
    it("should filter media by file_type=image", async () => {
      const imgPath = findSampleImagePath()
      if (!imgPath) {
        console.warn("Skipping file type filter test: sample image not found")
        return
      }

      // Upload an image first
      const fileBuf = fs.readFileSync(imgPath)
      const formData = new FormData()
      formData.append("files", fileBuf, {
        filename: "filter-test-image.jpg",
        contentType: "image/jpeg",
      })

      const formHeaders = formData.getHeaders()
      const uploadRes = await api.post("/admin/medias", formData, {
        ...headers,
        headers: {
          ...headers.headers,
          ...formHeaders,
        },
      })
      expect(uploadRes.status).toBe(201)

      // Query with file_type filter
      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[file_type]": "image",
        },
      })

      expect(listRes.status).toBe(200)
      expect(listRes.data).toBeDefined()

      // All returned items should be images
      const mediaFiles = listRes.data.media_files || listRes.data.mediaFiles || []
      for (const media of mediaFiles) {
        expect(media.file_type).toBe("image")
      }

      console.log(`Found ${mediaFiles.length} image files with file_type filter`)
    })

    it("should filter media by file_type=video", async () => {
      const unique = Date.now()
      const mediaService: any = getContainer().resolve("media")

      // Seed one public video and one public image into the global pool
      // so the video filter has something to match — and so we can prove
      // the image is excluded. Without seeding, an empty result set
      // passes vacuously and hides a broken filter.
      await mediaService.createMediaFiles({
        file_name: `admin-filter-vid-${unique}.mp4`,
        original_name: `admin-filter-vid-${unique}.mp4`,
        file_path: `https://cdn.example.com/admin-filter-vid-${unique}.mp4`,
        file_type: "video",
        mime_type: "video/mp4",
        file_size: 5000,
        file_hash: `hash-admin-vid-${unique}`,
        extension: "mp4",
        is_public: true,
      })
      await mediaService.createMediaFiles({
        file_name: `admin-filter-img-${unique}.jpg`,
        original_name: `admin-filter-img-${unique}.jpg`,
        file_path: `https://cdn.example.com/admin-filter-img-${unique}.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-admin-img-${unique}`,
        extension: "jpg",
        is_public: true,
      })

      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[file_type]": "video",
        },
      })

      expect(listRes.status).toBe(200)
      expect(listRes.data).toBeDefined()

      const mediaFiles = listRes.data.media_files || listRes.data.mediaFiles || []
      for (const media of mediaFiles) {
        expect(media.file_type).toBe("video")
      }

      const paths = mediaFiles.map((m: any) => m.file_path)
      expect(paths).toContain(`https://cdn.example.com/admin-filter-vid-${unique}.mp4`)
      expect(paths).not.toContain(`https://cdn.example.com/admin-filter-img-${unique}.jpg`)

      console.log(`Found ${mediaFiles.length} video files`)
    })

    it("should filter media by multiple file_type values (video + image)", async () => {
      const unique = Date.now()
      const mediaService: any = getContainer().resolve("media")

      // Seed one of each: video, image, and a document. The multi-type
      // filter (video + image) must return the first two and exclude the
      // document. If the route drops array file_type values, the filter
      // no-ops and the document leaks through.
      const mk = (file_type: string, ext: string, mime: string) =>
        mediaService.createMediaFiles({
          file_name: `multi-${file_type}-${unique}.${ext}`,
          original_name: `multi-${file_type}-${unique}.${ext}`,
          file_path: `https://cdn.example.com/multi-${file_type}-${unique}.${ext}`,
          file_type,
          mime_type: mime,
          file_size: 1000,
          file_hash: `hash-multi-${file_type}-${unique}`,
          extension: ext,
          is_public: true,
        })
      await mk("video", "mp4", "video/mp4")
      await mk("image", "jpg", "image/jpeg")
      await mk("document", "pdf", "application/pdf")

      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[file_type]": ["video", "image"],
        },
      })

      expect(listRes.status).toBe(200)
      const mediaFiles = listRes.data.media_files || listRes.data.mediaFiles || []

      const allowed = new Set(["video", "image"])
      for (const media of mediaFiles) {
        expect(allowed.has(media.file_type)).toBe(true)
      }

      const paths = mediaFiles.map((m: any) => m.file_path)
      expect(paths).toContain(`https://cdn.example.com/multi-video-${unique}.mp4`)
      expect(paths).toContain(`https://cdn.example.com/multi-image-${unique}.jpg`)
      expect(paths).not.toContain(`https://cdn.example.com/multi-document-${unique}.pdf`)

      console.log(`Found ${mediaFiles.length} files matching video+image`)
    })

    it("should ignore invalid file_type values", async () => {
      // Invalid file_type should be ignored, not cause an error
      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[file_type]": "invalid_type",
        },
      })

      expect(listRes.status).toBe(200)
      expect(listRes.data).toBeDefined()
      console.log("Invalid file_type correctly ignored")
    })

    it("should combine file_type filter with other filters", async () => {
      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[file_type]": "image",
          "filters[is_public]": true,
          take: 5,
        },
      })

      expect(listRes.status).toBe(200)
      expect(listRes.data).toBeDefined()

      const mediaFiles = listRes.data.media_files || listRes.data.mediaFiles || []
      expect(mediaFiles.length).toBeLessThanOrEqual(5)

      for (const media of mediaFiles) {
        expect(media.file_type).toBe("image")
      }
      console.log("Combined filters work correctly")
    })

    it("should filter media by is_public", async () => {
      const unique = Date.now()
      const mediaService: any = getContainer().resolve("media")

      // Seed one public and one private image. The is_public=true filter
      // must surface the public one and exclude the private one.
      await mediaService.createMediaFiles({
        file_name: `pub-${unique}.jpg`,
        original_name: `pub-${unique}.jpg`,
        file_path: `https://cdn.example.com/pub-${unique}.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-pub-${unique}`,
        extension: "jpg",
        is_public: true,
      })
      await mediaService.createMediaFiles({
        file_name: `priv-${unique}.jpg`,
        original_name: `priv-${unique}.jpg`,
        file_path: `https://cdn.example.com/priv-${unique}.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-priv-${unique}`,
        extension: "jpg",
        is_public: false,
      })

      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: { "filters[is_public]": true },
      })

      expect(listRes.status).toBe(200)
      const mediaFiles = listRes.data.media_files || listRes.data.mediaFiles || []
      for (const media of mediaFiles) {
        expect(media.is_public).toBe(true)
      }
      const paths = mediaFiles.map((m: any) => m.file_path)
      expect(paths).toContain(`https://cdn.example.com/pub-${unique}.jpg`)
      expect(paths).not.toContain(`https://cdn.example.com/priv-${unique}.jpg`)
      console.log("is_public filter works correctly")
    })

    it("should filter media by created_at range", async () => {
      const unique = Date.now()
      const mediaService: any = getContainer().resolve("media")

      // Seed a row, then bracket "now" so the range [start, end] captures it.
      await mediaService.createMediaFiles({
        file_name: `range-${unique}.jpg`,
        original_name: `range-${unique}.jpg`,
        file_path: `https://cdn.example.com/range-${unique}.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-range-${unique}`,
        extension: "jpg",
        is_public: true,
      })

      const start = new Date(unique - 60_000).toISOString()
      const end = new Date(unique + 60_000).toISOString()

      const inRange = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[created_at][gte]": start,
          "filters[created_at][lte]": end,
        },
      })
      expect(inRange.status).toBe(200)
      const inFiles = inRange.data.media_files || inRange.data.mediaFiles || []
      expect(inFiles.map((m: any) => m.file_path)).toContain(
        `https://cdn.example.com/range-${unique}.jpg`
      )

      // A window entirely in the past must exclude the just-seeded row.
      const pastEnd = new Date(unique - 60_000).toISOString()
      const pastStart = new Date(unique - 120_000).toISOString()
      const outRange = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[created_at][gte]": pastStart,
          "filters[created_at][lte]": pastEnd,
        },
      })
      expect(outRange.status).toBe(200)
      const outFiles = outRange.data.media_files || outRange.data.mediaFiles || []
      expect(outFiles.map((m: any) => m.file_path)).not.toContain(
        `https://cdn.example.com/range-${unique}.jpg`
      )
      console.log("created_at range filter works correctly")
    })

    it("should search media by file_name via q", async () => {
      const unique = Date.now()
      const mediaService: any = getContainer().resolve("media")

      // Seed two rows with distinct, searchable file_names. q must match the
      // one whose file_name contains the term and exclude the other. Guards
      // the regression where `q` was stripped before the list step.
      const token = `qsearch${unique}`
      await mediaService.createMediaFiles({
        file_name: `${token}-match.jpg`,
        original_name: `${token}-match.jpg`,
        file_path: `https://cdn.example.com/${token}-match.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-${token}-match`,
        extension: "jpg",
        is_public: true,
      })
      await mediaService.createMediaFiles({
        file_name: `other-${unique}-nomatch.jpg`,
        original_name: `other-${unique}-nomatch.jpg`,
        file_path: `https://cdn.example.com/other-${unique}-nomatch.jpg`,
        file_type: "image",
        mime_type: "image/jpeg",
        file_size: 1000,
        file_hash: `hash-other-${unique}`,
        extension: "jpg",
        is_public: true,
      })

      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: { "filters[q]": token },
      })

      expect(listRes.status).toBe(200)
      const mediaFiles = listRes.data.media_files || listRes.data.mediaFiles || []
      const paths = mediaFiles.map((m: any) => m.file_path)
      expect(paths).toContain(`https://cdn.example.com/${token}-match.jpg`)
      expect(paths).not.toContain(`https://cdn.example.com/other-${unique}-nomatch.jpg`)
      console.log(`q search matched ${mediaFiles.length} file(s)`)
    })
  })
})
