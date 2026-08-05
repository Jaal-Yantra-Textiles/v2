import {
  selectAdminToolSlice,
  matchDomains,
  toolDomain,
  toolsInDomains,
  ALWAYS_ON_TOOLS,
  SELECTABLE_DOMAINS,
} from "../tool-slice"
import { ADMIN_MCP_TOOLS } from "../registry"
import { buildToolInputSchema } from "../dispatch"

/** Rough token proxy — what actually gets serialised per tool definition. */
const weigh = (names: string[]) => {
  const byName = new Map(ADMIN_MCP_TOOLS.map((t) => [t.name, t]))
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

describe("admin-mcp per-ask tool slicing", () => {
  describe("domain classification", () => {
    it("classifies EVERY registry tool — an unclassified tool would be unreachable", () => {
      const orphans = ADMIN_MCP_TOOLS.filter((t) => !toolDomain(t)).map(
        (t) => `${t.name} (${t.path})`
      )
      expect(orphans).toEqual([])
    })

    it("resolves the longest matching prefix, not the first", () => {
      // /admin/production-run-policy must not be swallowed by a shorter prefix,
      // and /admin/mcp/usage must land on observability rather than core.
      expect(
        toolDomain(ADMIN_MCP_TOOLS.find((t) => t.name === "get_production_run_policy")!)
      ).toBe("production")
      expect(
        toolDomain(ADMIN_MCP_TOOLS.find((t) => t.name === "get_mcp_usage")!)
      ).toBe("observability")
      expect(
        toolDomain(ADMIN_MCP_TOOLS.find((t) => t.name === "get_admin_stats")!)
      ).toBe("core")
    })

    it("groups sibling route families under one domain", () => {
      const domainOf = (name: string) =>
        toolDomain(ADMIN_MCP_TOOLS.find((t) => t.name === name)!)
      // order-edits belong with orders, design-work-orders with designs.
      expect(domainOf("create_order_edit")).toBe("orders")
      expect(domainOf("list_order_changes")).toBe("orders")
      expect(domainOf("list_design_work_orders")).toBe("designs")
      expect(domainOf("update_production_run_policy")).toBe("production")
      // The artisan product tools live under /admin/partners, so they are
      // partner tools even though they act on a product.
      expect(domainOf("approve_partner_product")).toBe("partners")
    })

    it("every selectable domain actually owns tools", () => {
      for (const domain of SELECTABLE_DOMAINS) {
        expect({
          domain,
          count: toolsInDomains([domain], ADMIN_MCP_TOOLS).length,
        }).toEqual({ domain, count: expect.any(Number) })
        expect(toolsInDomains([domain], ADMIN_MCP_TOOLS).length).toBeGreaterThan(0)
      }
    })
  })

  describe("keyword matching", () => {
    it("matches the domain an operator is obviously asking about", () => {
      expect(matchDomains("ship order 123 and mark it delivered")).toContain("orders")
      expect(matchDomains("which production runs are still open?")).toContain(
        "production"
      )
      expect(matchDomains("set the size sets on this design")).toContain("designs")
      expect(matchDomains("onboard a new manufacturer partner")).toContain("partners")
      expect(matchDomains("how much raw material fabric is in stock")).toContain(
        "inventory"
      )
    })

    it("matches on word boundaries, not substrings", () => {
      // "reorder" must not light up inventory via a bare "order" substring...
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
      const slice = selectAdminToolSlice("hi", ADMIN_MCP_TOOLS)
      for (const name of ALWAYS_ON_TOOLS) {
        expect(slice.names).toContain(name)
      }
      expect(slice.domains).toEqual([])
    })

    it("a focused ask yields a small slice, not the whole registry", () => {
      const slice = selectAdminToolSlice(
        "cancel the fulfillment on order_123 and refund it",
        ADMIN_MCP_TOOLS
      )
      expect(slice.domains).toContain("orders")
      expect(slice.names).toContain("cancel_order_fulfillment")
      expect(slice.names).toContain("create_order_fulfillment")
      // Unrelated domains stay out.
      expect(slice.names).not.toContain("approve_production_run")
      expect(slice.names).not.toContain("create_partner")
      expect(slice.names.length).toBeLessThan(ADMIN_MCP_TOOLS.length / 2)
    })

    it("a multi-domain ask pulls in every domain it mentions", () => {
      const slice = selectAdminToolSlice(
        "approve the production run for this design and assign the partner",
        ADMIN_MCP_TOOLS
      )
      expect(slice.domains).toEqual(
        expect.arrayContaining(["production", "designs", "partners"])
      )
      expect(slice.names).toContain("approve_production_run")
      expect(slice.names).toContain("create_design_production_run")
      expect(slice.names).toContain("get_partner")
    })

    it("never re-admits a tool the write/dangerous gates removed", () => {
      const readsOnly = ADMIN_MCP_TOOLS.filter((t) => !t.write)
      const slice = selectAdminToolSlice(
        "cancel order 123 and delete the partner",
        readsOnly
      )
      expect(slice.names).not.toContain("cancel_order")
      expect(slice.names).not.toContain("delete_partner")
      // Everything it did pick is genuinely available.
      const available = new Set(readsOnly.map((t) => t.name))
      for (const n of slice.names) expect(available.has(n)).toBe(true)
    })

    it("cuts the serialised tool payload substantially for a focused ask", () => {
      const full = weigh(ADMIN_MCP_TOOLS.map((t) => t.name))
      const sliced = weigh(
        selectAdminToolSlice("ship order_123 today", ADMIN_MCP_TOOLS).names
      )
      expect(sliced).toBeLessThan(full / 2)
    })
  })

  describe("widening (the escape hatch)", () => {
    it("toolsInDomains returns exactly that domain's tools", () => {
      const names = toolsInDomains(["money"], ADMIN_MCP_TOOLS)
      expect(names).toContain("list_payments")
      expect(names).not.toContain("list_orders")
    })

    it("widening a slice can reach any tool the gates left enabled", () => {
      const slice = selectAdminToolSlice("hi", ADMIN_MCP_TOOLS)
      const activated = new Set(slice.names)
      for (const domain of SELECTABLE_DOMAINS) {
        toolsInDomains([domain], ADMIN_MCP_TOOLS).forEach((n) => activated.add(n))
      }
      // Core is always on, and every other domain is reachable on request, so
      // the union must cover the whole registry — nothing is orphaned.
      for (const def of ADMIN_MCP_TOOLS) {
        expect(`${def.name}:${activated.has(def.name)}`).toBe(`${def.name}:true`)
      }
    })

    it("ignores unknown domain names rather than throwing", () => {
      expect(toolsInDomains(["not_a_domain"], ADMIN_MCP_TOOLS)).toEqual([])
    })
  })

  describe("customs / HS codes reach the catalog slice", () => {
    // Two independent wirings must BOTH be right or the tools are invisible:
    // PREFIX_DOMAINS classifies them, DOMAIN_KEYWORDS activates the slice.
    it("classifies the customs tools as catalog", () => {
      const byName = new Map(ADMIN_MCP_TOOLS.map((t) => [t.name, t]))
      expect(toolDomain(byName.get("list_missing_hs_codes")!)).toBe("catalog")
      expect(toolDomain(byName.get("bulk_set_hs_codes")!)).toBe("catalog")
    })

    it.each([
      "the HSN is missing on a few products",
      "fill in HS codes for the catalogue",
      "our customs declaration is incomplete",
      "what tariff code should this scarf use?",
    ])("activates them for: %s", (ask) => {
      const slice = selectAdminToolSlice(ask, ADMIN_MCP_TOOLS)
      expect(slice.names).toContain("list_missing_hs_codes")
      expect(slice.names).toContain("bulk_set_hs_codes")
    })
  })
})
