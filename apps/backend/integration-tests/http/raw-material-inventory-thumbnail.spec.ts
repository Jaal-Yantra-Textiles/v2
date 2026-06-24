import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

/**
 * The inventory item's own `thumbnail` is never populated by hand — the actual
 * material image lives in `raw_material.media`. The create/update raw-material
 * workflows mirror the first usable media URL onto the linked inventory item's
 * thumbnail so the admin inventory table + storefront have something to show.
 */
setupSharedTestSuite(() => {
  let headers
  let inventoryItemId: string
  const { api, getContainer } = getSharedTestEnv()

  const mediaA = { files: ["https://cdn.example.com/material-a.jpg"] }
  const mediaB = { files: ["https://cdn.example.com/material-b.jpg"] }

  const fetchThumbnail = async () => {
    const res = await api.get(
      `/admin/inventory-items/${inventoryItemId}`,
      { headers: headers.headers }
    )
    return res.data.inventory_item.thumbnail
  }

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    const inventoryResponse = await api.post(
      "/admin/inventory-items",
      { title: "Thumbnail Test Inventory Item" },
      headers
    )
    inventoryItemId = inventoryResponse.data.inventory_item.id
  })

  it("sets the inventory item thumbnail from media on raw-material create", async () => {
    expect(await fetchThumbnail()).toBeFalsy()

    const response = await api.post(
      `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
      {
        rawMaterialData: {
          name: "Cotton With Image",
          description: "Cotton fabric with a catalog photo",
          composition: "100% Cotton",
          material_type: "Cotton",
          status: "Active",
          media: mediaA,
        },
      },
      headers
    )

    expect(response.status).toBe(201)
    expect(await fetchThumbnail()).toBe("https://cdn.example.com/material-a.jpg")
  })

  it("leaves the thumbnail untouched when the raw material has no media", async () => {
    const response = await api.post(
      `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
      {
        rawMaterialData: {
          name: "Cotton No Image",
          description: "Cotton fabric without a catalog photo",
          composition: "100% Cotton",
          material_type: "Cotton",
          status: "Active",
        },
      },
      headers
    )

    expect(response.status).toBe(201)
    expect(await fetchThumbnail()).toBeFalsy()
  })

  it("updates the inventory item thumbnail when media is added/changed on update", async () => {
    // Create without media → thumbnail stays empty.
    const createRes = await api.post(
      `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
      {
        rawMaterialData: {
          name: "Cotton To Be Imaged",
          description: "Cotton fabric imaged later via update",
          composition: "100% Cotton",
          material_type: "Cotton",
          status: "Active",
        },
      },
      headers
    )
    const rawMaterialId = createRes.data.raw_materials.id
    expect(await fetchThumbnail()).toBeFalsy()

    // Add media via update → thumbnail picks it up.
    await api.put(
      `/admin/inventory-items/${inventoryItemId}/rawmaterials/${rawMaterialId}`,
      { rawMaterialData: { media: mediaA } },
      headers
    )
    expect(await fetchThumbnail()).toBe("https://cdn.example.com/material-a.jpg")

    // Change media → thumbnail follows.
    await api.put(
      `/admin/inventory-items/${inventoryItemId}/rawmaterials/${rawMaterialId}`,
      { rawMaterialData: { media: mediaB } },
      headers
    )
    expect(await fetchThumbnail()).toBe("https://cdn.example.com/material-b.jpg")
  })
})
