import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import * as fs from "fs"
import * as path from "path"
import FormData from "form-data"

jest.setTimeout(45000)

const PUBLIC_IMAGE_URL = "https://i.ibb.co/0jL3htdV/sample-image.jpg"

const findSampleImagePath = (): string | null => {
  const imgPathCandidates = [
    path.join(__dirname, "../assets/sample-image.jpg"),
    path.join(__dirname, "../assets/sample-image.jpeg"),
    path.join(__dirname, "../assets/sample-image.png"),
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

  describe("POST /admin/ai/image-extraction with persist=true", () => {
    it("should upload image, extract items, and create inventory + raw materials when verification passes", async () => {
      const imgPath = findSampleImagePath()
      if (!imgPath) {
        console.warn("Skipping test: sample image not found in integration-tests/assets/")
        return
      }

      // 1) Upload media via media API
      const fileBuf = fs.readFileSync(imgPath)
      const formData = new FormData()
      const ext = path.extname(imgPath).toLowerCase()
      const contentType = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream"
      formData.append("files", fileBuf, { filename: path.basename(imgPath), contentType })

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
      const imageUrl = media.url || media.public_url || media.file_url || media.file_path

      // 2) Call AI extraction with persist=true
      const body = {
        // Use the provided public URL to avoid localhost reachability issues during model fetch
        image_url: PUBLIC_IMAGE_URL || imageUrl,
        entity_type: "raw_material",
        persist: true,
        hints: {
          allowed_units: ["Meter", "Kilogram", "Piece"],
          additional_context: "This image may contain spelling mistakes like 'Cottn' instead of 'Cotton'.",
        },
        verify: {
          min_items: 1,
          required_fields: ["name", "quantity"],
        },
      }

      const res = await api.post("/admin/ai/image-extraction", body, headers)

      expect([200, 201]).toContain(res.status)
      expect(res.data.result).toBeDefined()
      expect(res.data.result.extraction).toBeDefined()
      expect(res.data.result.extraction.items.length).toBeGreaterThan(0)

      // If persistence ran, expect IDs
      if (res.status === 201) {
        expect(Array.isArray(res.data.result.created_inventory_ids)).toBe(true)
        expect(Array.isArray(res.data.result.created_raw_material_ids)).toBe(true)
        expect(res.data.result.created_inventory_ids.length).toBeGreaterThan(0)
        expect(res.data.result.created_raw_material_ids.length).toBeGreaterThan(0)
      }
    })
  })
})
