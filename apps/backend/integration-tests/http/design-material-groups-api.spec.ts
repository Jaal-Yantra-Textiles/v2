import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { RAW_MATERIAL_MODULE } from "../../src/modules/raw_material"

jest.setTimeout(60000)

/**
 * #817 S4 — a design can pin one or more raw_material_groups (its material
 * palette at the group grain), optionally resolving a specific color, and unpin.
 */
setupSharedTestSuite(() => {
  let headers: any
  let designId: string
  let groupId: string
  let blueColorId: string
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    const design = await api.post(
      "/admin/designs",
      {
        name: "Group-Pin Tee",
        description: "S4 test",
        design_type: "Original",
        status: "In_Development",
        priority: "Medium",
      },
      headers
    )
    designId = design.data.design.id

    // A group + one color (created via the module directly — no route dependency).
    const service: any = container.resolve(RAW_MATERIAL_MODULE)
    const group = await service.createRawMaterialGroups({
      name: "Jersey Knit",
      composition: "95% Cotton 5% Elastane",
      unit_of_measure: "Meter",
    })
    groupId = group.id
    const blue = await service.createRawMaterials({
      name: "Jersey Knit — Blue",
      description: "blue",
      composition: "95% Cotton 5% Elastane",
      color: "Blue",
      group_id: group.id,
    })
    blueColorId = blue.id
  })

  it("pins a group to a design and lists it with its colors", async () => {
    const pin = await api.post(
      `/admin/designs/${designId}/material-groups`,
      { raw_material_group_id: groupId, note: "primary body fabric" },
      headers
    )
    expect(pin.status).toBe(201)

    const list = await api.get(
      `/admin/designs/${designId}/material-groups`,
      { headers: headers.headers }
    )
    expect(list.status).toBe(200)
    expect(list.data.count).toBe(1)
    const row = list.data.material_groups[0]
    expect(row.raw_material_group.id).toBe(groupId)
    expect(row.note).toBe("primary body fabric")
    expect(row.resolved_raw_material_id ?? null).toBeNull()
    const colors = row.raw_material_group.raw_materials.map((c: any) => c.color)
    expect(colors).toContain("Blue")
  })

  it("resolves a color on the pin (production-time)", async () => {
    await api.post(
      `/admin/designs/${designId}/material-groups`,
      { raw_material_group_id: groupId },
      headers
    )
    const upd = await api.post(
      `/admin/designs/${designId}/material-groups/${groupId}`,
      { resolved_raw_material_id: blueColorId },
      headers
    )
    expect(upd.status).toBe(200)

    const list = await api.get(
      `/admin/designs/${designId}/material-groups`,
      { headers: headers.headers }
    )
    expect(list.data.material_groups[0].resolved_raw_material_id).toBe(blueColorId)
  })

  it("unpins a group from a design", async () => {
    await api.post(
      `/admin/designs/${designId}/material-groups`,
      { raw_material_group_id: groupId },
      headers
    )
    const del = await api.delete(
      `/admin/designs/${designId}/material-groups/${groupId}`,
      { headers: headers.headers }
    )
    expect(del.status).toBe(200)

    const list = await api.get(
      `/admin/designs/${designId}/material-groups`,
      { headers: headers.headers }
    )
    expect(list.data.count).toBe(0)
  })

  it("404s pinning a group that does not exist", async () => {
    const res = await api
      .post(
        `/admin/designs/${designId}/material-groups`,
        { raw_material_group_id: "rmgrp_missing" },
        headers
      )
      .catch((e: any) => e.response)
    expect(res.status).toBe(404)
  })
})
