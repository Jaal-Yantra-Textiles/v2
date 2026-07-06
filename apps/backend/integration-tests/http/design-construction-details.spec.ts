import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

/**
 * #892 — CRUD for construction details (Construction specs with a technique) and the
 * loop it closes: a design with a size set but no construction detail is NOT
 * generatable (400); once a detail is attached via this API it becomes generatable.
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
      name: "Construction CRUD design",
      description: "for construction-details api",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    designId = design.id
    // A size set so the ONLY thing gating generation is the construction detail.
    await designService.createDesignSizeSets({
      design_id: designId,
      size_label: "M",
      measurements: { chest: 50, length: 66 },
    })
  })

  const base = `/admin/designs`

  it("creates, lists, updates and deletes a construction detail", async () => {
    // Create
    const created = await api.post(
      `${base}/${designId}/construction-details`,
      {
        technique: "dart",
        label: "Waist dart",
        params: { intake: 0.6 },
        fabricRules: ["press toward CF", "clip at apex"],
        note: "single-point shaping",
      },
      headers
    )
    expect(created.status).toBe(201)
    const detailId = created.data.construction_detail.id
    expect(created.data.construction_detail.metadata.technique).toBe("dart")
    expect(created.data.construction_detail.metadata.params).toEqual({ intake: 0.6 })

    // List
    const listed = await api.get(`${base}/${designId}/construction-details`, {
      headers: headers.headers,
    })
    expect(listed.status).toBe(200)
    expect(listed.data.count).toBe(1)
    expect(listed.data.construction_details[0].id).toBe(detailId)

    // Update — change label + params; technique preserved via metadata merge
    const updated = await api.patch(
      `${base}/${designId}/construction-details/${detailId}`,
      { label: "Front dart", params: { intake: 0.8 } },
      headers
    )
    expect(updated.status).toBe(200)
    expect(updated.data.construction_detail.title).toBe("Front dart")
    expect(updated.data.construction_detail.metadata.params).toEqual({ intake: 0.8 })
    expect(updated.data.construction_detail.metadata.technique).toBe("dart")

    // Delete
    const del = await api.delete(
      `${base}/${designId}/construction-details/${detailId}`,
      headers
    )
    expect(del.status).toBe(200)
    expect(del.data.deleted).toBe(true)

    const afterDelete = await api.get(`${base}/${designId}/construction-details`, {
      headers: headers.headers,
    })
    expect(afterDelete.data.count).toBe(0)
  })

  it("rejects an unsupported technique with 400", async () => {
    const res = await api
      .post(
        `${base}/${designId}/construction-details`,
        { technique: "not-a-real-technique" },
        headers
      )
      .catch((e: any) => e.response)
    expect(res.status).toBe(400)
    expect(res.data.message).toMatch(/technique/)
  })

  it("makes an otherwise-incomplete design generatable once a detail is attached", async () => {
    // Before: size set present but no construction detail → generation blocked.
    const before = await api
      .post(`${base}/${designId}/moodboard/generate`, {}, headers)
      .catch((e: any) => e.response)
    expect(before.status).toBe(400)
    expect(before.data.message).toMatch(/Construction specification/)

    // Attach a detail…
    await api.post(
      `${base}/${designId}/construction-details`,
      { technique: "gathers", params: { ratio: 1.6 } },
      headers
    )

    // After: generation succeeds and the construction frame is present.
    const after = await api.post(
      `${base}/${designId}/moodboard/generate`,
      {},
      headers
    )
    expect(after.status).toBe(200)
    const frameNames = after.data.moodboard.elements
      .filter((e: any) => e.type === "frame")
      .map((f: any) => f.name)
    expect(frameNames).toContain("4 · Construction details")
    expect(frameNames).toContain("2 · Measurements")
  })
})
