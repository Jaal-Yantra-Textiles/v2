import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

const sampleRawMaterial = {
  rawMaterialData: {
    name: "Cotton Poplin",
    description: "Lightweight cotton poplin fabric for shirts",
    composition: "100% Cotton",
    unit_of_measure: "Meter",
    color: "White",
    width: "150cm",
    weight: "120gsm",
    grade: "A",
    minimum_order_quantity: 50,
    lead_time_days: 14,
    usage_guidelines: "Pre-wash before cutting",
    storage_requirements: "Store in dry area",
    material_type: "Cotton",
    status: "Active",
  },
}

const sampleRawMaterialWithCategory = {
  rawMaterialData: {
    name: "Merino Wool Yarn",
    description: "Fine merino wool yarn for knitting",
    composition: "100% Merino Wool",
    unit_of_measure: "Kilogram",
    color: "Natural",
    weight: "2-ply",
    material_type: "Merino",
    status: "Active",
  },
}

setupSharedTestSuite(() => {
  let headers
  let inventoryItemId: string
  let rawMaterialId: string
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    // Create an inventory item for raw material tests
    const inventoryResponse = await api.post(
      "/admin/inventory-items",
      { title: "Test Fabric Inventory Item" },
      headers
    )
    inventoryItemId = inventoryResponse.data.inventory_item.id
  })

  describe("POST /admin/inventory-items/:id/rawmaterials", () => {
    it("should create a raw material linked to an inventory item", async () => {
      const response = await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterial,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data).toMatchObject({
        id: inventoryItemId,
        raw_materials: expect.objectContaining({
          id: expect.any(String),
          name: sampleRawMaterial.rawMaterialData.name,
          composition: sampleRawMaterial.rawMaterialData.composition,
          color: sampleRawMaterial.rawMaterialData.color,
          unit_of_measure: sampleRawMaterial.rawMaterialData.unit_of_measure,
        }),
      })

      rawMaterialId = response.data.raw_materials.id
    })

    it("should create a raw material and auto-generate a material type", async () => {
      const response = await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterialWithCategory,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data.raw_materials).toMatchObject({
        name: sampleRawMaterialWithCategory.rawMaterialData.name,
        composition: sampleRawMaterialWithCategory.rawMaterialData.composition,
      })
    })

    it("should fail to create a raw material without required fields", async () => {
      const response = await api
        .post(
          `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
          { rawMaterialData: { description: "Missing name and composition" } },
          headers
        )
        .catch((err) => err.response)

      expect(response.status).toBe(400)
    })

    it("should auto-generate SKU when creating a raw material", async () => {
      const response = await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterial,
        headers
      )

      expect(response.status).toBe(201)

      // Fetch inventory item to check SKU
      const fetchResponse = await api.get(
        `/admin/inventory-items/${inventoryItemId}`,
        { headers: headers.headers }
      )

      const sku = fetchResponse.data.inventory_item.sku
      expect(sku).toBeTruthy()
      expect(typeof sku).toBe("string")
      // Should match pattern like OTH-COT-WHI-001 or similar
      expect(sku).toMatch(/^[A-Z]+-[A-Z]+(-[A-Z]+)?-\d{3,}$/)
    })
  })

  describe("GET /admin/inventory-items/:id/rawmaterials/:rawMaterialId", () => {
    beforeEach(async () => {
      const createResponse = await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterial,
        headers
      )
      rawMaterialId = createResponse.data.raw_materials.id
    })

    it("should retrieve a specific raw material", async () => {
      const response = await api.get(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials/${rawMaterialId}`,
        { headers: headers.headers }
      )

      expect(response.status).toBe(200)
      expect(response.data.raw_materials).toMatchObject({
        id: rawMaterialId,
        name: sampleRawMaterial.rawMaterialData.name,
      })
    })

    it("should return 404 for non-existent raw material", async () => {
      const response = await api
        .get(
          `/admin/inventory-items/${inventoryItemId}/rawmaterials/rm_nonexistent`,
          { headers: headers.headers }
        )
        .catch((err) => err.response)

      expect([404, 500]).toContain(response.status)
    })
  })

  describe("PUT /admin/inventory-items/:id/rawmaterials/:rawMaterialId", () => {
    beforeEach(async () => {
      const createResponse = await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterial,
        headers
      )
      rawMaterialId = createResponse.data.raw_materials.id
    })

    it("should update a raw material", async () => {
      const updateData = {
        rawMaterialData: {
          name: "Updated Cotton Poplin",
          composition: "98% Cotton, 2% Elastane",
          color: "Navy",
        },
      }

      const response = await api.put(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials/${rawMaterialId}`,
        updateData,
        headers
      )

      expect(response.status).toBe(200)
      expect(response.data.raw_materials).toMatchObject({
        name: updateData.rawMaterialData.name,
        composition: updateData.rawMaterialData.composition,
        color: updateData.rawMaterialData.color,
      })
    })

    it("should update only specified fields", async () => {
      const updateData = {
        rawMaterialData: {
          grade: "B",
        },
      }

      const response = await api.put(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials/${rawMaterialId}`,
        updateData,
        headers
      )

      expect(response.status).toBe(200)
      expect(response.data.raw_materials.grade).toBe("B")
      // Original fields should remain
      expect(response.data.raw_materials.name).toBe(sampleRawMaterial.rawMaterialData.name)
    })
  })

  describe("DELETE /admin/inventory-items/:id/rawmaterials/:rawMaterialId", () => {
    beforeEach(async () => {
      const createResponse = await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterial,
        headers
      )
      rawMaterialId = createResponse.data.raw_materials.id
    })

    it("should delete a raw material", async () => {
      const response = await api.delete(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials/${rawMaterialId}`,
        headers
      )

      expect(response.status).toBe(200)
    })
  })

  describe("GET /admin/inventory-items/raw-materials", () => {
    beforeEach(async () => {
      await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterial,
        headers
      )
    })

    it("should list all inventory items with raw materials", async () => {
      const response = await api.get(
        "/admin/inventory-items/raw-materials",
        { headers: headers.headers }
      )

      expect(response.status).toBe(200)
      expect(response.data.inventory_items).toBeInstanceOf(Array)
      expect(response.data.inventory_items.length).toBeGreaterThanOrEqual(1)
    })

    it("should support full-text search via q parameter", async () => {
      const response = await api.get(
        `/admin/inventory-items/raw-materials?q=${sampleRawMaterial.rawMaterialData.name}`,
        { headers: headers.headers }
      )

      expect(response.status).toBe(200)
      expect(response.data.inventory_items.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("GET /admin/inventory-items/:id/labels", () => {
    beforeEach(async () => {
      await api.post(
        `/admin/inventory-items/${inventoryItemId}/rawmaterials`,
        sampleRawMaterial,
        headers
      )
    })

    it("should return a PDF barcode label", async () => {
      const response = await api.get(
        `/admin/inventory-items/${inventoryItemId}/labels`,
        {
          headers: headers.headers,
          responseType: "arraybuffer",
        }
      )

      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toBe("application/pdf")

      const pdfBuffer = Buffer.from(response.data)
      expect(pdfBuffer.length).toBeGreaterThan(100)
      expect(pdfBuffer.toString("ascii", 0, 5)).toBe("%PDF-")
    })

    it("should return error when no SKU exists", async () => {
      // Create an inventory item without raw material
      const noSkuItem = await api.post(
        "/admin/inventory-items",
        { title: "No SKU Item" },
        headers
      )
      const noSkuId = noSkuItem.data.inventory_item.id

      const response = await api
        .get(`/admin/inventory-items/${noSkuId}/labels`, {
          headers: headers.headers,
        })
        .catch((err) => err.response)

      expect(response.status).toBe(400)
    })
  })
})
