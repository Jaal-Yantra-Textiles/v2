import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

/**
 * #892 — /outline route wiring. The potrace raster work is skipped under TEST_TYPE
 * (returns a mock SVG), so this asserts auth, validation, and the response contract
 * without loading potrace or hitting the network.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any
  let designId: string

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
    const designService: any = container.resolve(DESIGN_MODULE)
    const design = await designService.createDesigns({
      name: "Outline target",
      description: "for outline route",
      design_type: "Original",
      status: "Conceptual",
      priority: "Low",
    })
    designId = design.id
  })

  it("returns an SVG outline for a valid image (mocked in test env)", async () => {
    const res = await api.post(
      `/admin/designs/${designId}/outline`,
      { image_url: "https://cdn.example.com/cutout.png" },
      headers
    )
    expect(res.status).toBe(200)
    expect(res.data.outline.mode).toBe("outline")
    expect(res.data.outline.svg).toContain("<svg")
    expect(res.data.outline.svg).toContain("<path")
    expect(res.data.outline.image_url).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(res.data.outline.width).toBe(100)
    expect(res.data.outline.height).toBe(100)
  })

  it("honours mode=posterize", async () => {
    const res = await api.post(
      `/admin/designs/${designId}/outline`,
      { image_base64: "data:image/png;base64,AAAA", mode: "posterize", steps: 4 },
      headers
    )
    expect(res.status).toBe(200)
    expect(res.data.outline.mode).toBe("posterize")
  })

  it("400s when no image is supplied", async () => {
    const res = await api
      .post(`/admin/designs/${designId}/outline`, { mode: "outline" }, headers)
      .catch((e: any) => e.response)
    expect(res.status).toBe(400)
  })

  it("400s on an out-of-range threshold", async () => {
    const res = await api
      .post(
        `/admin/designs/${designId}/outline`,
        { image_url: "https://cdn.example.com/cutout.png", threshold: 999 },
        headers
      )
      .catch((e: any) => e.response)
    expect(res.status).toBe(400)
  })

  it("requires authentication", async () => {
    const res = await api
      .post(`/admin/designs/${designId}/outline`, {
        image_url: "https://cdn.example.com/cutout.png",
      })
      .catch((e: any) => e.response)
    expect(res.status).toBe(401)
  })
})
