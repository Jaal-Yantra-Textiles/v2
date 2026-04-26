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
      const mediaFiles = listRes.data.mediaFiles || []
      for (const media of mediaFiles) {
        expect(media.file_type).toBe("image")
      }

      console.log(`Found ${mediaFiles.length} image files with file_type filter`)
    })

    it("should filter media by file_type=video", async () => {
      const listRes = await api.get("/admin/medias", {
        ...headers,
        params: {
          "filters[file_type]": "video",
        },
      })

      expect(listRes.status).toBe(200)
      expect(listRes.data).toBeDefined()

      // All returned items should be videos (or empty if none exist)
      const mediaFiles = listRes.data.mediaFiles || []
      for (const media of mediaFiles) {
        expect(media.file_type).toBe("video")
      }

      console.log(`Found ${mediaFiles.length} video files`)
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

      const mediaFiles = listRes.data.mediaFiles || []
      expect(mediaFiles.length).toBeLessThanOrEqual(5)

      for (const media of mediaFiles) {
        expect(media.file_type).toBe("image")
      }
      console.log("Combined filters work correctly")
    })
  })
})
