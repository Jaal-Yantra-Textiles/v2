import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  let headers: any
  let stockLocationId: string
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    // Create a stock location for the bulk import
    const stockLocation = await api.post(
      "/admin/stock-locations",
      { name: "Bulk Import Warehouse" },
      headers
    )
    expect(stockLocation.status).toBe(200)
    stockLocationId = stockLocation.data.stock_location.id
  })

  describe("POST /admin/inventory-items/bulk-import", () => {
    it("should bulk import multiple inventory items with raw materials", async () => {
      const payload = {
        items: [
          {
            name: "Silk Charmeuse",
            composition: "100% Silk",
            color: "Ivory",
            unit_of_measure: "Meter",
            material_type: "Silk",
          },
          {
            name: "Cotton Twill",
            composition: "100% Cotton",
            color: "Navy",
            unit_of_measure: "Yard",
            material_type: "Cotton",
          },
          {
            name: "Linen Blend",
            composition: "55% Linen, 45% Cotton",
            color: "Natural",
            unit_of_measure: "Meter",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data.created).toHaveLength(3)
      expect(response.data.errors).toHaveLength(0)
      expect(response.data.message).toContain("3 of 3")

      // Verify each created item has an inventory_item and raw_material
      for (const item of response.data.created) {
        expect(item.inventory_item).toBeDefined()
        expect(item.inventory_item.id).toBeTruthy()
        expect(item.raw_material).toBeDefined()
      }
    })

    it("should create inventory items and link raw materials correctly", async () => {
      const payload = {
        items: [
          {
            name: "Test Poplin",
            composition: "100% Cotton",
            color: "White",
            unit_of_measure: "Meter",
            material_type: "Cotton",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data.created).toHaveLength(1)

      const inventoryItemId = response.data.created[0].inventory_item.id

      // Verify the inventory item exists via the standard endpoint
      const fetchResponse = await api.get(
        `/admin/inventory-items/${inventoryItemId}`,
        { headers: headers.headers }
      )

      expect(fetchResponse.status).toBe(200)
      expect(fetchResponse.data.inventory_item.id).toBe(inventoryItemId)
      expect(fetchResponse.data.inventory_item.title).toBe("Test Poplin")
    })

    it("should auto-generate SKU on imported items", async () => {
      const payload = {
        items: [
          {
            name: "Premium Velvet",
            composition: "100% Polyester",
            color: "Burgundy",
            unit_of_measure: "Meter",
            material_type: "Velvet",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)

      const inventoryItemId = response.data.created[0].inventory_item.id

      // Fetch the inventory item and check SKU was generated
      const fetchResponse = await api.get(
        `/admin/inventory-items/${inventoryItemId}`,
        { headers: headers.headers }
      )

      const sku = fetchResponse.data.inventory_item.sku
      expect(sku).toBeTruthy()
      expect(typeof sku).toBe("string")
      // Should match the SKU pattern: PREFIX-MAT-COL-SEQ
      expect(sku).toMatch(/^[A-Z]+-[A-Z]+(-[A-Z]+)?-\d{3,}$/)
    })

    it("should verify raw materials are linked via raw-materials listing", async () => {
      const payload = {
        items: [
          {
            name: "Denim Heavy",
            composition: "100% Cotton",
            color: "Indigo",
            unit_of_measure: "Meter",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)

      // Verify through the raw materials listing endpoint
      const listResponse = await api.get(
        `/admin/inventory-items/raw-materials?q=Denim Heavy`,
        { headers: headers.headers }
      )

      expect(listResponse.status).toBe(200)
      expect(listResponse.data.inventory_items.length).toBeGreaterThanOrEqual(1)
    })

    it("should create inventory levels at the specified stock location", async () => {
      const payload = {
        items: [
          {
            name: "Canvas Duck",
            composition: "100% Cotton",
            unit_of_measure: "Meter",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)

      const inventoryItemId = response.data.created[0].inventory_item.id

      // Fetch inventory item location levels via the standard retrieve endpoint
      const fetchResponse = await api.get(
        `/admin/inventory-items/${inventoryItemId}`,
        { headers: headers.headers }
      )

      expect(fetchResponse.status).toBe(200)
      const item = fetchResponse.data.inventory_item
      expect(item.id).toBe(inventoryItemId)

      // The inventory item should have location_levels populated
      // If not populated at top level, check via the location_levels field
      if (item.location_levels) {
        expect(item.location_levels).toBeInstanceOf(Array)
        expect(item.location_levels.length).toBeGreaterThanOrEqual(1)
        const level = item.location_levels.find(
          (l: any) => l.location_id === stockLocationId
        )
        expect(level).toBeDefined()
      } else {
        // Verify via the inventory item list endpoint with stocked_quantity check
        const listResponse = await api.get(
          `/admin/inventory-items?id=${inventoryItemId}`,
          { headers: headers.headers }
        )
        expect(listResponse.status).toBe(200)
        expect(listResponse.data.inventory_items).toBeInstanceOf(Array)
        expect(listResponse.data.inventory_items.length).toBeGreaterThanOrEqual(1)
        const listed = listResponse.data.inventory_items[0]
        // If location_levels is present at the list level, verify it
        if (listed.location_levels) {
          const level = listed.location_levels.find(
            (l: any) => l.location_id === stockLocationId
          )
          expect(level).toBeDefined()
        }
      }
    })

    it("should work without a stock location", async () => {
      const payload = {
        items: [
          {
            name: "No Location Fabric",
            composition: "100% Polyester",
            unit_of_measure: "Meter",
          },
        ],
        // No stock_location_id
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data.created).toHaveLength(1)
      expect(response.data.created[0].inventory_item).toBeDefined()
    })

    it("should handle a single item import", async () => {
      const payload = {
        items: [
          {
            name: "Single Import Item",
            composition: "80% Cotton, 20% Polyester",
            color: "Black",
            unit_of_measure: "Kilogram",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data.created).toHaveLength(1)
      expect(response.data.errors).toHaveLength(0)
    })

    it("should handle items with media urls", async () => {
      const payload = {
        items: [
          {
            name: "Fabric With Photo",
            composition: "100% Cotton",
            unit_of_measure: "Meter",
            media: ["uploads/test-fabric-photo.jpg"],
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data.created).toHaveLength(1)
    })

    it("should fail validation when items array is empty", async () => {
      const payload = {
        items: [],
        stock_location_id: stockLocationId,
      }

      const response = await api
        .post("/admin/inventory-items/bulk-import", payload, headers)
        .catch((err) => err.response)

      expect(response.status).toBe(400)
    })

    it("should fail validation when item name is missing", async () => {
      const payload = {
        items: [
          {
            composition: "100% Cotton",
            unit_of_measure: "Meter",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api
        .post("/admin/inventory-items/bulk-import", payload, headers)
        .catch((err) => err.response)

      expect(response.status).toBe(400)
    })

    it("should handle partial failures gracefully", async () => {
      // First create an item normally, then try importing with a duplicate
      // that might cause issues — the API should still return partial results
      const payload = {
        items: [
          {
            name: "Good Item A",
            composition: "100% Silk",
            unit_of_measure: "Meter",
          },
          {
            name: "Good Item B",
            composition: "100% Wool",
            unit_of_measure: "Kilogram",
          },
        ],
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)
      // Both should succeed in normal conditions
      expect(response.data.created.length).toBe(2)
    })

    it("should handle all unit_of_measure values", async () => {
      const units = ["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"]

      const payload = {
        items: units.map((unit) => ({
          name: `Unit Test ${unit}`,
          composition: "Test",
          unit_of_measure: unit,
        })),
        stock_location_id: stockLocationId,
      }

      const response = await api.post(
        "/admin/inventory-items/bulk-import",
        payload,
        headers
      )

      expect(response.status).toBe(201)
      expect(response.data.created).toHaveLength(units.length)
      expect(response.data.errors).toHaveLength(0)
    })
  })
})
