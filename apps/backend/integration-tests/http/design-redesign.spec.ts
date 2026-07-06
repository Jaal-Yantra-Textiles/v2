import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

/**
 * #892 — /redesign route wiring. The real Nano-Banana call is skipped under TEST_TYPE
 * (returns a mock image), so this asserts auth, validation, and the response contract
 * without burning AI credits.
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
      name: "Redesign target",
      description: "for redesign route",
      design_type: "Original",
      status: "Conceptual",
      priority: "Low",
    })
    designId = design.id
  })

  it("returns a render for a valid image + prompt (mocked in test env)", async () => {
    const res = await api.post(
      `/admin/designs/${designId}/redesign`,
      {
        image_url: "https://cdn.example.com/flat.png",
        prompt: "add contrast piping on the collar",
      },
      headers
    )
    expect(res.status).toBe(200)
    expect(res.data.redesign.image_url).toMatch(/^data:image\//)
    expect(res.data.redesign.model).toBe("google/gemini-2.5-flash-image")
    // The stored prompt is the structure-preserving wrapper around the user's text.
    expect(res.data.redesign.prompt).toContain("add contrast piping on the collar")
    expect(res.data.redesign.prompt.toLowerCase()).toContain("preserve")
  })

  it("400s when no image is supplied", async () => {
    const res = await api
      .post(`/admin/designs/${designId}/redesign`, { prompt: "add piping" }, headers)
      .catch((e: any) => e.response)
    expect(res.status).toBe(400)
  })

  it("400s on an empty prompt", async () => {
    const res = await api
      .post(
        `/admin/designs/${designId}/redesign`,
        { image_url: "https://cdn.example.com/flat.png", prompt: "  " },
        headers
      )
      .catch((e: any) => e.response)
    expect(res.status).toBe(400)
  })

  it("requires authentication", async () => {
    const res = await api
      .post(`/admin/designs/${designId}/redesign`, {
        image_url: "https://cdn.example.com/flat.png",
        prompt: "add piping",
      })
      .catch((e: any) => e.response)
    expect(res.status).toBe(401)
  })
})
