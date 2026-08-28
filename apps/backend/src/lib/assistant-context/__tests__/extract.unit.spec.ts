import { describe, it, expect } from "@jest/globals"
import {
  extractContextFromTurn,
  extractEntityIds,
  toolNameToDomain,
} from "../index"

describe("assistant-context: toolNameToDomain", () => {
  it("maps order tools to orders domain", () => {
    expect(toolNameToDomain("list_orders")).toBe("orders")
    expect(toolNameToDomain("get_order")).toBe("orders")
    expect(toolNameToDomain("update_order")).toBe("orders")
    expect(toolNameToDomain("create_order_shipment")).toBe("orders")
  })

  it("maps product tools to catalog domain", () => {
    expect(toolNameToDomain("list_products")).toBe("catalog")
    expect(toolNameToDomain("get_product")).toBe("catalog")
    expect(toolNameToDomain("update_product_variant")).toBe("catalog")
    expect(toolNameToDomain("list_missing_hs_codes")).toBe("catalog")
  })

  it("maps design tools to designs domain", () => {
    expect(toolNameToDomain("list_designs")).toBe("designs")
    expect(toolNameToDomain("create_design")).toBe("designs")
    expect(toolNameToDomain("update_design_brief")).toBe("designs")
    expect(toolNameToDomain("list_construction_techniques")).toBe("designs")
  })

  it("maps production tools to production domain", () => {
    expect(toolNameToDomain("list_production_runs")).toBe("production")
    expect(toolNameToDomain("approve_production_run")).toBe("production")
    expect(toolNameToDomain("send_production_run_to_production")).toBe("production")
  })

  it("maps inventory tools to inventory domain", () => {
    expect(toolNameToDomain("list_inventory_items")).toBe("inventory")
    expect(toolNameToDomain("list_raw_materials")).toBe("inventory")
    expect(toolNameToDomain("create_raw_material_group")).toBe("inventory")
    expect(toolNameToDomain("extract_inventory_from_image")).toBe("inventory")
  })

  it("maps marketing tools to marketing domain", () => {
    expect(toolNameToDomain("list_publishing_campaigns")).toBe("marketing")
    expect(toolNameToDomain("create_social_post")).toBe("marketing")
  })

  it("returns undefined for cross-cutting tools", () => {
    expect(toolNameToDomain("load_admin_tools")).toBeUndefined()
    expect(toolNameToDomain("load_partner_tools")).toBeUndefined()
    expect(toolNameToDomain("get_admin_stats")).toBeUndefined()
    expect(toolNameToDomain("get_partner_profile")).toBeUndefined()
    expect(toolNameToDomain("resolve_admin_query")).toBeUndefined()
    expect(toolNameToDomain("read_image")).toBeUndefined()
    expect(toolNameToDomain("describe_image")).toBeUndefined()
  })
})

describe("assistant-context: extractEntityIds", () => {
  it("extracts ids from a flat array of objects", () => {
    const result = extractEntityIds({
      orders: [
        { id: "order_abc", status: "pending" },
        { id: "order_def", status: "completed" },
      ],
    })
    expect(result).toContain("order_abc")
    expect(result).toContain("order_def")
    expect(result).toHaveLength(2)
  })

  it("extracts ids from nested structures", () => {
    const result = extractEntityIds({
      data: {
        items: [
          { id: "prod_123", variants: [{ id: "variant_456" }] },
          { id: "prod_789", variants: [] },
        ],
        partner: { id: "partner_xyz" },
      },
    })
    expect(result).toContain("prod_123")
    expect(result).toContain("variant_456")
    expect(result).toContain("prod_789")
    expect(result).toContain("partner_xyz")
  })

  it("extracts bare string ids", () => {
    const result = extractEntityIds(["order_aaa", "order_bbb", "not_an_id"])
    expect(result).toContain("order_aaa")
    expect(result).toContain("order_bbb")
    expect(result).not.toContain("not_an_id")
  })

  it("ignores short strings that match a prefix", () => {
    expect(extractEntityIds(["order_ab"])).toEqual([])
    expect(extractEntityIds(["order_abc"])).toContain("order_abc")
  })

  it("deduplicates ids", () => {
    const result = extractEntityIds({
      a: { id: "order_123" },
      b: { id: "order_123" },
      c: ["order_123"],
    })
    expect(result).toEqual(["order_123"])
  })

  it("handles null and undefined", () => {
    expect(extractEntityIds(null)).toEqual([])
    expect(extractEntityIds(undefined)).toEqual([])
    expect(extractEntityIds({})).toEqual([])
  })
})

describe("assistant-context: extractContextFromTurn", () => {
  it("extracts per-domain entries from tool results", () => {
    const entries = extractContextFromTurn([
      {
        toolName: "list_orders",
        output: {
          orders: [
            { id: "order_001", status: "pending", total: 2500 },
            { id: "order_002", status: "completed", total: 1200 },
          ],
        },
      },
      {
        toolName: "list_products",
        output: {
          products: [
            { id: "prod_100", title: "Cotton Kurta" },
          ],
        },
      },
    ])

    expect(entries).toHaveLength(2)
    const ordersEntry = entries.find((e) => e.domain === "orders")
    expect(ordersEntry).toBeDefined()
    expect(ordersEntry!.entityIds).toContain("order_001")
    expect(ordersEntry!.entityIds).toContain("order_002")
    expect(ordersEntry!.summary).toContain("list_orders")
    expect(ordersEntry!.summary).toContain("2 orders")

    const catalogEntry = entries.find((e) => e.domain === "catalog")
    expect(catalogEntry).toBeDefined()
    expect(catalogEntry!.entityIds).toContain("prod_100")
    expect(catalogEntry!.summary).toContain("Cotton Kurta")
  })

  it("groups multiple tools in the same domain", () => {
    const entries = extractContextFromTurn([
      { toolName: "list_orders", output: { orders: [{ id: "order_abc" }] } },
      { toolName: "get_order", output: { id: "order_def", status: "pending" } },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].domain).toBe("orders")
    expect(entries[0].entityIds).toContain("order_abc")
    expect(entries[0].entityIds).toContain("order_def")
    expect(entries[0].summary).toContain("list_orders")
    expect(entries[0].summary).toContain("get_order")
  })

  it("skips tools with no domain (cross-cutting)", () => {
    const entries = extractContextFromTurn([
      { toolName: "load_admin_tools", output: { ok: true } },
      { toolName: "get_admin_stats", output: { orders: 5 } },
      { toolName: "list_orders", output: { orders: [{ id: "order_1" }] } },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].domain).toBe("orders")
  })

  it("handles empty or undefined tool results", () => {
    expect(extractContextFromTurn(undefined)).toEqual([])
    expect(extractContextFromTurn([])).toEqual([])
    expect(extractContextFromTurn([{ output: {} }])).toEqual([])
    expect(extractContextFromTurn([{ toolName: undefined, output: {} }])).toEqual([])
  })

  it("caps entity ids at MAX_ENTITY_IDS", () => {
    const orders = Array.from({ length: 30 }, (_, i) => ({
      id: `order_${String(i).padStart(3, "0")}`,
    }))
    const entries = extractContextFromTurn([
      { toolName: "list_orders", output: { orders } },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].entityIds.length).toBeLessThanOrEqual(20)
  })

  it("caps summary at MAX_SUMMARY_LEN", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      toolName: "list_orders",
      output: { orders: [{ id: `order_${i}` }] },
    }))
    const entries = extractContextFromTurn(many)

    expect(entries).toHaveLength(1)
    expect(entries[0].summary.length).toBeLessThanOrEqual(200)
  })

  it("extracts natural-key entity resolutions from tool results", () => {
    const entries = extractContextFromTurn([
      {
        toolName: "list_customers",
        output: {
          customers: [
            { id: "cus_01KS9B", email: "delhi@gmail.com", first_name: "Delhi" },
          ],
        },
      },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].domain).toBe("customers")
    expect(entries[0].resolutions).toEqual([
      expect.objectContaining({
        type: "customer",
        key: "email",
        value: "delhi@gmail.com",
        id: "cus_01KS9B",
      }),
    ])
  })

  it("deduplicates resolutions across tools in the same domain", () => {
    const entries = extractContextFromTurn([
      { toolName: "list_customers", output: { customers: [{ id: "cus_01KS9B", email: "a@b.com" }] } },
      { toolName: "get_customer", output: { id: "cus_01KS9B", email: "a@b.com" } },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].resolutions).toHaveLength(1)
  })
})
