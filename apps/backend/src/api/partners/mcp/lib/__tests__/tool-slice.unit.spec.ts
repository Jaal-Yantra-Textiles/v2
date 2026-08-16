import {
  selectPartnerToolSlice,
  matchDomains,
  toolDomain,
  toolsInDomains,
  ALWAYS_ON_TOOLS,
  SELECTABLE_DOMAINS,
} from "../tool-slice"
import { PARTNER_MCP_TOOLS } from "../registry"
import { buildToolInputSchema } from "../dispatch"

/** Rough token proxy — what actually gets serialised per tool definition. */
const weigh = (names: string[]) => {
  const byName = new Map(PARTNER_MCP_TOOLS.map((t) => [t.name, t]))
  const defs = names
    .map((n) => byName.get(n))
    .filter(Boolean)
    .map((d: any) => ({
      name: d.name,
      description: d.description,
      schema: buildToolInputSchema(d),
    }))
  return Math.round(JSON.stringify(defs).length / 4)
}

describe("partner-mcp per-ask tool slicing", () => {
  describe("domain classification", () => {
    it("classifies EVERY registry tool — an unclassified tool would be unreachable", () => {
      const orphans = PARTNER_MCP_TOOLS.filter((t) => !toolDomain(t)).map(
        (t) => `${t.name} (${t.path})`
      )
      expect(orphans).toEqual([])
    })

    it("classifies store-product tools as storefront, NOT catalog", () => {
      // bulk_update_products lives under /partners/stores/:id/products/bulk-update,
      // so it classifies as storefront — even though a partner thinks "products".
      const byName = new Map(PARTNER_MCP_TOOLS.map((t) => [t.name, t]))
      expect(toolDomain(byName.get("bulk_update_products")!)).toBe("storefront")
      expect(toolDomain(byName.get("update_store_product")!)).toBe("storefront")
      // ...while the partner's own product record + taxonomy stay in catalog.
      expect(toolDomain(byName.get("create_product")!)).toBe("catalog")
      expect(toolDomain(byName.get("list_product_categories")!)).toBe("catalog")
    })

    it("groups sibling route families under one domain", () => {
      const domainOf = (name: string) =>
        toolDomain(PARTNER_MCP_TOOLS.find((t) => t.name === name)!)
      expect(domainOf("create_order_fulfillment")).toBe("orders")
      expect(domainOf("list_returns")).toBe("orders")
      expect(domainOf("add_design_media")).toBe("designs")
      expect(domainOf("accept_production_run")).toBe("production")
      expect(domainOf("list_raw_materials")).toBe("inventory")
      expect(domainOf("create_customer")).toBe("customers")
      expect(domainOf("get_payment")).toBe("money")
      // The cross-cutting surface (identity, onboarding, layout, media, ai,
      // notifications, currencies) is the always-present core.
      expect(domainOf("get_partner_profile")).toBe("core")
      expect(domainOf("describe_image")).toBe("core")
      expect(domainOf("list_currencies")).toBe("core")
    })

    it("every selectable domain actually owns tools", () => {
      for (const domain of SELECTABLE_DOMAINS) {
        expect({
          domain,
          count: toolsInDomains([domain], PARTNER_MCP_TOOLS).length,
        }).toEqual({ domain, count: expect.any(Number) })
        expect(toolsInDomains([domain], PARTNER_MCP_TOOLS).length).toBeGreaterThan(0)
      }
    })
  })

  describe("keyword matching", () => {
    it("matches the domain a partner is obviously asking about", () => {
      expect(matchDomains("ship order 123 and mark it delivered")).toContain("orders")
      expect(matchDomains("which production runs are still open?")).toContain(
        "production"
      )
      expect(matchDomains("set the size sets on this design")).toContain("designs")
      expect(matchDomains("how much raw material fabric is in stock")).toContain(
        "inventory"
      )
      expect(matchDomains("update my storefront website and domain")).toContain(
        "storefront"
      )
      expect(matchDomains("list my customers and their groups")).toContain(
        "customers"
      )
      expect(matchDomains("what payments have come in")).toContain("money")
      expect(matchDomains("create a new product category")).toContain("catalog")
    })

    it("matches on word boundaries, not substrings", () => {
      // "reordering" must not light up orders via a bare "order" substring...
      expect(matchDomains("reordering the dashboard widgets")).not.toContain("orders")
      // ...but the real word still matches.
      expect(matchDomains("cancel this order")).toContain("orders")
    })

    it("returns nothing for an ask with no operational vocabulary", () => {
      expect(matchDomains("hi, what can you do?")).toEqual([])
    })
  })

  describe("slice selection", () => {
    it("always includes grounding + the top-level list reads, whatever the ask", () => {
      const slice = selectPartnerToolSlice("hi", PARTNER_MCP_TOOLS)
      for (const name of ALWAYS_ON_TOOLS) {
        expect(slice.names).toContain(name)
      }
      expect(slice.domains).toEqual([])
    })

    it("a focused ask yields a small slice, not the whole registry", () => {
      const slice = selectPartnerToolSlice(
        "ship order_123 today and mark it delivered",
        PARTNER_MCP_TOOLS
      )
      expect(slice.domains).toContain("orders")
      expect(slice.names).toContain("create_order_fulfillment")
      expect(slice.names).toContain("mark_fulfillment_delivered")
      // Unrelated domains stay out.
      expect(slice.names).not.toContain("accept_production_run")
      expect(slice.names).not.toContain("create_store")
      expect(slice.names).not.toContain("get_payment")
      expect(slice.names.length).toBeLessThan(PARTNER_MCP_TOOLS.length / 2)
    })

    it("a multi-domain ask pulls in every domain it mentions", () => {
      const slice = selectPartnerToolSlice(
        "accept the production run for this design and update its media",
        PARTNER_MCP_TOOLS
      )
      expect(slice.domains).toEqual(
        expect.arrayContaining(["production", "designs"])
      )
      expect(slice.names).toContain("accept_production_run")
      expect(slice.names).toContain("update_design")
      expect(slice.names).toContain("add_design_media")
    })

    it("never re-admits a tool the write gate removed", () => {
      const readsOnly = PARTNER_MCP_TOOLS.filter((t) => !t.write)
      const slice = selectPartnerToolSlice(
        "delete the customer and create a return",
        readsOnly
      )
      expect(slice.names).not.toContain("delete_customer")
      expect(slice.names).not.toContain("create_return")
      // Everything it did pick is genuinely available.
      const available = new Set(readsOnly.map((t) => t.name))
      for (const n of slice.names) expect(available.has(n)).toBe(true)
    })

    it("cuts the serialised tool payload substantially for a focused ask", () => {
      const full = weigh(PARTNER_MCP_TOOLS.map((t) => t.name))
      const sliced = weigh(
        selectPartnerToolSlice("ship order_123 today", PARTNER_MCP_TOOLS).names
      )
      expect(sliced).toBeLessThan(full / 2)
    })
  })

  describe("widening (the escape hatch)", () => {
    it("toolsInDomains returns exactly that domain's tools", () => {
      const names = toolsInDomains(["money"], PARTNER_MCP_TOOLS)
      expect(names).toContain("list_payment_providers")
      expect(names).not.toContain("list_orders")
    })

    it("widening a slice can reach any tool the write gate left enabled", () => {
      const slice = selectPartnerToolSlice("hi", PARTNER_MCP_TOOLS)
      const activated = new Set(slice.names)
      for (const domain of SELECTABLE_DOMAINS) {
        toolsInDomains([domain], PARTNER_MCP_TOOLS).forEach((n) =>
          activated.add(n)
        )
      }
      // Core is always on, and every other domain is reachable on request, so
      // the union must cover the whole registry — nothing is orphaned.
      for (const def of PARTNER_MCP_TOOLS) {
        expect(`${def.name}:${activated.has(def.name)}`).toBe(`${def.name}:true`)
      }
    })

    it("ignores unknown domain names rather than throwing", () => {
      expect(toolsInDomains(["not_a_domain"], PARTNER_MCP_TOOLS)).toEqual([])
    })
  })

  describe("bulk store-product edits reach the storefront slice", () => {
    // bulk_update_products classifies as storefront (it lives under
    // /partners/stores), and the asks that need it are phrased in bulk/product
    // words. Without these keywords the one tool that can serve them never
    // loads — the partner would be told "impossible".
    it("classifies bulk_update_products as storefront", () => {
      const byName = new Map(PARTNER_MCP_TOOLS.map((t) => [t.name, t]))
      expect(toolDomain(byName.get("bulk_update_products")!)).toBe("storefront")
    })

    it.each([
      "bulk update the prices on all my products",
      "update all products in this store in bulk",
      "set stock to zero for every product",
    ])("activates it for: %s", (ask) => {
      const slice = selectPartnerToolSlice(ask, PARTNER_MCP_TOOLS)
      expect(slice.names).toContain("bulk_update_products")
    })
  })

  describe("storefront management reaches the storefront slice", () => {
    it.each([
      "publish my storefront website",
      "set up a custom domain for my storefront",
      "redeploy the storefront after an edit",
      "provision my storefront",
      "add a page to my storefront",
    ])("activates storefront for: %s", (ask) => {
      const slice = selectPartnerToolSlice(ask, PARTNER_MCP_TOOLS)
      expect(slice.domains).toContain("storefront")
    })
  })
})
