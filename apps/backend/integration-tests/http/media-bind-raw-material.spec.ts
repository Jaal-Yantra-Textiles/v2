import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { MEDIA_MODULE } from "../../src/modules/media"
import { RAW_MATERIAL_MODULE } from "../../src/modules/raw_material"

jest.setTimeout(60000)

const makeMediaFile = async (mediaService: any, suffix: string) => {
  const file = await mediaService.createMediaFiles({
    file_name: `photo-${suffix}.jpg`,
    original_name: `photo-${suffix}.jpg`,
    file_path: `https://cdn.example.com/uploads/photo-${suffix}.jpg`,
    file_size: 1234,
    file_type: "image",
    mime_type: "image/jpeg",
    extension: "jpg",
  })
  return Array.isArray(file) ? file[0] : file
}

setupSharedTestSuite(() => {
  let headers: any
  let inventoryItemId: string
  let rawMaterialId: string
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    const inventoryResponse = await api.post(
      "/admin/inventory-items",
      { title: "Bind Test Inventory Item" },
      headers
    )
    inventoryItemId = inventoryResponse.data.inventory_item.id

    const rmResponse = await api.post(
      `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
      {
        rawMaterialData: {
          name: "Bind Test Fabric",
          description: "Bind test fabric",
          composition: "100% Cotton",
          unit_of_measure: "Meter",
          material_type: "Cotton",
          status: "Active",
        },
      },
      headers
    )
    rawMaterialId = rmResponse.data.raw_materials.id
  })

  describe("POST /admin/medias/file/:id/raw-material (bind)", () => {
    it("binds the photo into raw_materials.media (canonical { files }) and is idempotent", async () => {
      const container = getContainer()
      const mediaService: any = container.resolve(MEDIA_MODULE)
      const rawService: any = container.resolve(RAW_MATERIAL_MODULE)
      const media = await makeMediaFile(mediaService, "bind")

      const res = await api.post(
        `/admin/medias/file/${media.id}/raw-material`,
        { raw_material_id: rawMaterialId },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.bound).toBe(true)
      expect(res.data.media_url).toBe(media.file_path)
      expect(res.data.raw_material.media).toEqual({
        files: [media.file_path],
      })

      // persisted on the raw material
      const raw = await rawService.retrieveRawMaterial(rawMaterialId)
      expect(raw.media).toEqual({ files: [media.file_path] })

      // back-reference stamped on the media file
      const refreshed = await mediaService.retrieveMediaFile(media.id)
      expect(refreshed.metadata?.bound_raw_material_id).toBe(rawMaterialId)

      // idempotent — binding the same url again does not duplicate
      const again = await api.post(
        `/admin/medias/file/${media.id}/raw-material`,
        { raw_material_id: rawMaterialId },
        headers
      )
      expect(again.status).toBe(200)
      expect(again.data.raw_material.media).toEqual({
        files: [media.file_path],
      })
    })

    it("sets the SKU on the linked inventory item when provided", async () => {
      const container = getContainer()
      const mediaService: any = container.resolve(MEDIA_MODULE)
      const inventoryService: any = container.resolve("inventory")
      const media = await makeMediaFile(mediaService, "sku")

      const res = await api.post(
        `/admin/medias/file/${media.id}/raw-material`,
        {
          raw_material_id: rawMaterialId,
          sku: "RM-SKU-12345",
          inventory_item_id: inventoryItemId,
        },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.sku).toBe("RM-SKU-12345")

      const inv = await inventoryService.retrieveInventoryItem(inventoryItemId)
      expect(inv.sku).toBe("RM-SKU-12345")
    })

    it("creates a new raw material inline and binds the photo", async () => {
      const container = getContainer()
      const mediaService: any = container.resolve(MEDIA_MODULE)
      const rawService: any = container.resolve(RAW_MATERIAL_MODULE)
      const media = await makeMediaFile(mediaService, "create")

      const res = await api.post(
        `/admin/medias/file/${media.id}/raw-material`,
        { create: { name: "Unrecorded Scrap Piece", sku: "RM-NEW-001" } },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.bound).toBe(true)
      const newId = res.data.raw_material_id
      expect(newId).toBeTruthy()
      expect(newId).not.toBe(rawMaterialId)

      const raw = await rawService.retrieveRawMaterial(newId)
      expect(raw.name).toBe("Unrecorded Scrap Piece")
      expect(raw.media).toEqual({ files: [media.file_path] })
    })

    it("returns 400 when neither raw_material_id nor create is provided", async () => {
      const container = getContainer()
      const mediaService: any = container.resolve(MEDIA_MODULE)
      const media = await makeMediaFile(mediaService, "bad")

      await expect(
        api.post(`/admin/medias/file/${media.id}/raw-material`, {}, headers)
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })

  describe("GET /admin/medias/file/:id/raw-material", () => {
    it("reflects the current binding", async () => {
      const container = getContainer()
      const mediaService: any = container.resolve(MEDIA_MODULE)
      const media = await makeMediaFile(mediaService, "get")

      const before = await api.get(
        `/admin/medias/file/${media.id}/raw-material`,
        headers
      )
      expect(before.data.binding).toBeNull()

      await api.post(
        `/admin/medias/file/${media.id}/raw-material`,
        { raw_material_id: rawMaterialId },
        headers
      )

      const after = await api.get(
        `/admin/medias/file/${media.id}/raw-material`,
        headers
      )
      expect(after.data.binding).toMatchObject({
        raw_material_id: rawMaterialId,
      })
    })
  })

  describe("DELETE /admin/medias/file/:id/raw-material (unbind)", () => {
    it("removes the photo from raw_materials.media and clears the back-reference", async () => {
      const container = getContainer()
      const mediaService: any = container.resolve(MEDIA_MODULE)
      const rawService: any = container.resolve(RAW_MATERIAL_MODULE)
      const media = await makeMediaFile(mediaService, "unbind")

      await api.post(
        `/admin/medias/file/${media.id}/raw-material`,
        { raw_material_id: rawMaterialId },
        headers
      )

      const res = await api.delete(
        `/admin/medias/file/${media.id}/raw-material`,
        { ...headers, data: { raw_material_id: rawMaterialId } }
      )
      expect(res.status).toBe(200)
      expect(res.data.unbound).toBe(true)

      const raw = await rawService.retrieveRawMaterial(rawMaterialId)
      expect(raw.media).toEqual({ files: [] })

      // binding is cleared per the GET contract
      const after = await api.get(
        `/admin/medias/file/${media.id}/raw-material`,
        headers
      )
      expect(after.data.binding).toBeNull()
    })
  })
})
