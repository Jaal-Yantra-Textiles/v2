import { describe, it, expect } from "@jest/globals"
import { formatPriorContext, type ContextCacheRow } from "../index"

describe("assistant-context: formatPriorContext", () => {
  it("returns undefined for empty rows", () => {
    expect(formatPriorContext([])).toBeUndefined()
  })

  it("formats a single domain entry", () => {
    const rows: ContextCacheRow[] = [
      {
        domain: "orders",
        entity_ids: ["order_001", "order_002"],
        summary: "list_orders: 2 orders, first: order_001",
        // Within the volatile-domain window: `orders` entries older than an
        // hour are now dropped rather than injected (see wiring.unit.spec).
        updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ]
    const result = formatPriorContext(rows)
    expect(result).toBeDefined()
    expect(result!).toContain("Prior context from earlier conversations")
    expect(result!).toContain("### orders")
    expect(result!).toContain("list_orders: 2 orders")
    expect(result!).toContain("Entity ids: order_001, order_002")
    expect(result!).toContain("30 min ago")
  })

  it("formats multiple domain entries", () => {
    const rows: ContextCacheRow[] = [
      {
        domain: "orders",
        entity_ids: ["order_001"],
        summary: "list_orders: 1 orders",
        updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
      {
        domain: "catalog",
        entity_ids: ["prod_100", "prod_200"],
        summary: "list_products: 2 products, first: Cotton Kurta",
        updated_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      },
    ]
    const result = formatPriorContext(rows)
    expect(result!).toContain("### orders")
    expect(result!).toContain("30 min ago")
    expect(result!).toContain("### catalog")
    expect(result!).toContain("5 hours ago")
  })

  it("limits to MAX_DOMAIN_ENTRIES (3)", () => {
    const rows: ContextCacheRow[] = [
      "orders", "catalog", "designs", "production", "inventory",
    ].map((domain) => ({
        domain,
        entity_ids: [`id_${domain}`],
        summary: `summary for ${domain}`,
        updated_at: new Date().toISOString(),
      }))
    const result = formatPriorContext(rows)
    // Should only have 3 domain sections
    const sections = result!.match(/### \w+/g)
    expect(sections).toHaveLength(3)
  })

  it("truncates entity id list to 8", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `order_${i}`)
    const rows: ContextCacheRow[] = [
      {
        domain: "orders",
        entity_ids: ids,
        summary: "12 orders",
        updated_at: new Date().toISOString(),
      },
    ]
    const result = formatPriorContext(rows)
    expect(result!).toContain("+4 more")
    expect(result!).toContain("order_0, order_1")
    expect(result!).not.toContain("order_11")
  })

  it("handles non-array entity_ids gracefully", () => {
    const rows: ContextCacheRow[] = [
      {
        domain: "orders",
        entity_ids: null as any,
        summary: "some orders",
        updated_at: new Date().toISOString(),
      },
    ]
    const result = formatPriorContext(rows)
    expect(result).toBeDefined()
    expect(result!).toContain("some orders")
    expect(result!).not.toContain("Entity ids")
  })

  it("surfaces known id resolutions", () => {
    const rows: ContextCacheRow[] = [
      {
        domain: "customers",
        entity_ids: ["cus_01KS9B"],
        entity_resolutions: [
          { type: "customer", key: "email", value: "delhi@gmail.com", id: "cus_01KS9B" },
        ],
        summary: "list_customers: 1 customer",
        updated_at: new Date().toISOString(),
      },
    ]
    const result = formatPriorContext(rows)
    expect(result!).toContain("Known: customer delhi@gmail.com = cus_01KS9B")
  })

  it("omits the Known line when there are no resolutions", () => {
    const rows: ContextCacheRow[] = [
      {
        domain: "customers",
        entity_ids: ["cus_01KS9B"],
        summary: "list_customers: 1 customer",
        updated_at: new Date().toISOString(),
      },
    ]
    expect(formatPriorContext(rows)!).not.toContain("Known:")
  })

  it("uses relative time formatting", () => {
    const cases: [number, string][] = [
      [0, "just now"],
      [30 * 60 * 1000, "30 min ago"],
      [3 * 60 * 60 * 1000, "3 hours ago"],
      [20 * 60 * 60 * 1000, "20 hours ago"],
    ]
    // A slow-moving domain, so this stays a test of the FORMATTER: every age
    // here has to survive the freshness filter to reach the string.
    for (const [ms, expected] of cases) {
      const rows: ContextCacheRow[] = [
        {
          domain: "catalog",
          entity_ids: [],
          summary: "test",
          updated_at: new Date(Date.now() - ms).toISOString(),
        },
      ]
      const result = formatPriorContext(rows)
      expect(result!).toContain(expected)
    }
  })
})
