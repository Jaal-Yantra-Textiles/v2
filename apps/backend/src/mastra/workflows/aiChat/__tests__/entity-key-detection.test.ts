/**
 * Unit tests for entity key detection in AI V4 workflow
 *
 * Tests the logic that extracts items from Medusa API responses
 * which use entity-specific keys like { products: [...] } or { orders: [...] }
 *
 * Run with:
 *   npx jest src/mastra/workflows/aiV4/__tests__/entity-key-detection.test.ts
 */

describe("Entity Key Detection", () => {
  // Common Medusa entity keys (pluralized)
  const entityKeys = [
    "products", "orders", "customers", "collections", "categories", "regions",
    "currencies", "stores", "inventory_items", "stock_locations", "price_lists",
    "promotions", "campaigns", "tax_rates", "shipping_options", "payment_providers",
    "fulfillment_providers", "sales_channels", "api_keys", "users", "invites",
    "designs", "partners", "production_runs", "inventory_orders", "tasks",
    "feedbacks", "agreements", "persons", "media", "websites", "forms",
    "email_templates", "visual_flows", "social_posts", "publishing_campaigns",
    "feature_flags", "notifications", "payments",
  ]

  const metadataKeys = ["count", "offset", "limit", "total", "page", "pages"]

  /**
   * Simulates the entity key detection logic from generateResponseStep
   */
  function extractItems(fetchedData: Record<string, any>): any[] | null {
    // Check standard keys first
    let itemsValue = fetchedData.items ?? fetchedData.data ?? fetchedData.partners ?? fetchedData.results

    if (!itemsValue) {
      const dataKeys = Object.keys(fetchedData)

      // First try known entity keys
      for (const key of entityKeys) {
        if (dataKeys.includes(key) && Array.isArray(fetchedData[key])) {
          itemsValue = fetchedData[key]
          break
        }
      }

      // If still not found, try any array key (excluding metadata keys)
      if (!itemsValue) {
        for (const key of dataKeys) {
          if (!metadataKeys.includes(key) && Array.isArray(fetchedData[key])) {
            itemsValue = fetchedData[key]
            break
          }
        }
      }
    }

    return itemsValue || null
  }

  describe("Standard Keys", () => {
    it("should extract items from 'items' key", () => {
      const data = { items: [{ id: 1 }, { id: 2 }], count: 2 }
      const result = extractItems(data)
      expect(result).toEqual([{ id: 1 }, { id: 2 }])
    })

    it("should extract items from 'data' key", () => {
      const data = { data: [{ id: 1 }], count: 1 }
      const result = extractItems(data)
      expect(result).toEqual([{ id: 1 }])
    })

    it("should extract items from 'results' key", () => {
      const data = { results: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 3 }
      const result = extractItems(data)
      expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    })
  })

  describe("Core Medusa Entity Keys", () => {
    it("should extract items from 'products' key", () => {
      const data = {
        products: [
          { id: "prod_1", title: "Product 1" },
          { id: "prod_2", title: "Product 2" },
        ],
        count: 2,
        offset: 0,
        limit: 10,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
      expect(result![0].id).toBe("prod_1")
    })

    it("should extract items from 'orders' key", () => {
      const data = {
        orders: [
          { id: "order_1", status: "pending" },
          { id: "order_2", status: "completed" },
          { id: "order_3", status: "pending" },
        ],
        count: 3,
        offset: 0,
        limit: 20,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(3)
      expect(result![0].status).toBe("pending")
    })

    it("should extract items from 'customers' key", () => {
      const data = {
        customers: [
          { id: "cus_1", email: "a@test.com" },
          { id: "cus_2", email: "b@test.com" },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
    })

    it("should extract items from 'collections' key", () => {
      const data = {
        collections: [{ id: "col_1", title: "Summer" }],
        count: 1,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(1)
      expect(result![0].title).toBe("Summer")
    })

    it("should extract items from 'regions' key", () => {
      const data = {
        regions: [
          { id: "reg_1", name: "US" },
          { id: "reg_2", name: "EU" },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
    })

    it("should extract items from 'inventory_items' key", () => {
      const data = {
        inventory_items: [
          { id: "inv_1", sku: "SKU001" },
        ],
        count: 1,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(1)
      expect(result![0].sku).toBe("SKU001")
    })
  })

  describe("Custom Entity Keys", () => {
    it("should extract items from 'designs' key", () => {
      const data = {
        designs: [
          { id: "design_1", name: "Design A", status: "In_Development" },
          { id: "design_2", name: "Design B", status: "Completed" },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
      expect(result![0].name).toBe("Design A")
    })

    it("should extract items from 'partners' key (standard key)", () => {
      const data = {
        partners: [
          { id: "partner_1", name: "Partner A" },
          { id: "partner_2", name: "Partner B" },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
    })

    it("should extract items from 'production_runs' key", () => {
      const data = {
        production_runs: [
          { id: "run_1", status: "pending" },
          { id: "run_2", status: "in_progress" },
          { id: "run_3", status: "completed" },
        ],
        count: 3,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(3)
    })

    it("should extract items from 'inventory_orders' key", () => {
      const data = {
        inventory_orders: [
          { id: "io_1", order_number: "IO-001" },
        ],
        count: 1,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(1)
    })

    it("should extract items from 'tasks' key", () => {
      const data = {
        tasks: [
          { id: "task_1", title: "Task 1", completed: false },
          { id: "task_2", title: "Task 2", completed: true },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
    })

    it("should extract items from 'feedbacks' key", () => {
      const data = {
        feedbacks: [
          { id: "fb_1", rating: 5 },
        ],
        count: 1,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(1)
    })

    it("should extract items from 'persons' key", () => {
      const data = {
        persons: [
          { id: "person_1", name: "John" },
          { id: "person_2", name: "Jane" },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
    })

    it("should extract items from 'visual_flows' key", () => {
      const data = {
        visual_flows: [
          { id: "flow_1", name: "Flow A" },
        ],
        count: 1,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(1)
    })

    it("should extract items from 'publishing_campaigns' key", () => {
      const data = {
        publishing_campaigns: [
          { id: "pc_1", name: "Campaign 1", status: "active" },
          { id: "pc_2", name: "Campaign 2", status: "paused" },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
    })
  })

  describe("Dynamic Array Key Detection", () => {
    it("should detect unknown entity array key", () => {
      // Simulate a new entity type not in our list
      const data = {
        unknown_entities: [
          { id: "unk_1" },
          { id: "unk_2" },
        ],
        count: 2,
        offset: 0,
        limit: 10,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
    })

    it("should NOT extract metadata keys as items", () => {
      // Only metadata, no actual items
      const data = {
        count: 5,
        offset: 0,
        limit: 10,
        total: 5,
      }
      const result = extractItems(data)
      expect(result).toBeNull()
    })

    it("should prefer known entity keys over unknown keys", () => {
      const data = {
        products: [{ id: "prod_1" }],
        unknown_array: [{ id: "unk_1" }, { id: "unk_2" }],
        count: 1,
      }
      const result = extractItems(data)
      // Should find products first (known key)
      expect(result).toHaveLength(1)
      expect(result![0].id).toBe("prod_1")
    })
  })

  describe("Edge Cases", () => {
    it("should handle empty arrays", () => {
      const data = {
        products: [],
        count: 0,
      }
      const result = extractItems(data)
      expect(result).toEqual([])
    })

    it("should handle null/undefined values", () => {
      const data = {
        products: null,
        orders: undefined,
        count: 0,
      }
      const result = extractItems(data)
      expect(result).toBeNull()
    })

    it("should handle non-array values", () => {
      const data = {
        products: "not an array",
        orders: { not: "array" },
        count: 0,
      }
      const result = extractItems(data)
      expect(result).toBeNull()
    })

    it("should handle deeply nested data", () => {
      const data = {
        products: [
          {
            id: "prod_1",
            variants: [{ id: "var_1" }],
            images: [{ url: "http://..." }],
          },
        ],
        count: 1,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(1)
      expect(result![0].variants).toHaveLength(1)
    })

    it("should handle large datasets", () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: `prod_${i}`,
        title: `Product ${i}`,
      }))
      const data = {
        products: items,
        count: 100,
        offset: 0,
        limit: 100,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(100)
    })

    it("should handle mixed standard and entity keys (standard takes precedence)", () => {
      const data = {
        items: [{ id: "item_1" }],
        products: [{ id: "prod_1" }, { id: "prod_2" }],
        count: 1,
      }
      const result = extractItems(data)
      // 'items' takes precedence as it's checked first
      expect(result).toHaveLength(1)
      expect(result![0].id).toBe("item_1")
    })
  })

  describe("Feature Flags (MCP Generic Path)", () => {
    it("should extract feature_flags from response", () => {
      const data = {
        feature_flags: [
          { key: "flag_1", value: true },
          { key: "flag_2", value: false },
        ],
        count: 2,
      }
      const result = extractItems(data)
      expect(result).toHaveLength(2)
      expect(result![0].key).toBe("flag_1")
    })
  })

  describe("Count Extraction", () => {
    /**
     * Simulates count extraction logic from generateResponseStep
     */
    function extractCount(fetchedData: Record<string, any>): number | undefined {
      return fetchedData.count ?? fetchedData.totalPartners ?? fetchedData.total ?? fetchedData.totalCount
    }

    it("should extract count from 'count' key", () => {
      const data = { products: [], count: 5 }
      expect(extractCount(data)).toBe(5)
    })

    it("should extract count from 'total' key", () => {
      const data = { products: [], total: 10 }
      expect(extractCount(data)).toBe(10)
    })

    it("should extract count from 'totalCount' key", () => {
      const data = { products: [], totalCount: 15 }
      expect(extractCount(data)).toBe(15)
    })

    it("should extract count from 'totalPartners' key (LLM generated)", () => {
      const data = { partners: [], totalPartners: 3 }
      expect(extractCount(data)).toBe(3)
    })

    it("should return undefined when no count key exists", () => {
      const data = { products: [{ id: 1 }] }
      expect(extractCount(data)).toBeUndefined()
    })
  })
})

describe("listAndCount Normalization", () => {
  /**
   * Simulates the normalization of listAndCount results
   */
  function normalizeListAndCount(result: any): { items?: any[]; count?: number } {
    if (Array.isArray(result) && result.length === 2 && typeof result[1] === "number") {
      return { items: result[0], count: result[1] }
    }
    return result
  }

  it("should normalize [items, count] tuple to object", () => {
    const result = [[{ id: 1 }, { id: 2 }], 2]
    const normalized = normalizeListAndCount(result)
    expect(normalized.items).toHaveLength(2)
    expect(normalized.count).toBe(2)
  })

  it("should pass through already normalized objects", () => {
    const result = { items: [{ id: 1 }], count: 1 }
    const normalized = normalizeListAndCount(result)
    expect(normalized).toEqual(result)
  })

  it("should pass through entity-specific response", () => {
    const result = { products: [{ id: 1 }], count: 1 }
    const normalized = normalizeListAndCount(result)
    expect(normalized).toEqual(result)
  })

  it("should not normalize arrays that are not tuples", () => {
    const result = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const normalized = normalizeListAndCount(result)
    expect(normalized).toEqual(result)
  })

  it("should handle empty tuple", () => {
    const result = [[], 0]
    const normalized = normalizeListAndCount(result)
    expect(normalized.items).toEqual([])
    expect(normalized.count).toBe(0)
  })
})
