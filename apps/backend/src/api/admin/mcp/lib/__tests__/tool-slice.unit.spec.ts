import {
  selectAdminToolSlice,
  matchDomains,
  toolDomain,
  toolsInDomains,
  widenedDomainsFromHistory,
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

  describe("the CRM reaches the vocabulary people actually use", () => {
    // #1315's lesson: a tool that CLASSIFIES into a domain is not the same as a
    // tool that is REACHABLE. These asks are how a founder actually phrases CRM
    // work, and most of them never contain the word "crm".
    const byName = new Map(ADMIN_MCP_TOOLS.map((t) => [t.name, t]))

    it("classifies the CRM tools and the lead intake into one domain", () => {
      expect(toolDomain(byName.get("list_crm_contacts")!)).toBe("crm")
      expect(toolDomain(byName.get("update_crm_opportunity")!)).toBe("crm")
      // The ad-lead list is the CRM's intake queue, not a marketing report.
      expect(toolDomain(byName.get("list_ad_leads")!)).toBe("crm")
    })

    it.each([
      "who came in from the ads and hasn't been contacted?",
      "show me the leads from last month",
      "what's in the pipeline right now?",
      "move this deal to sampling",
      "which deals are at quoted?",
      "log a note against this contact",
      "who do I need to follow up with this week?",
      "list the enquiries that came through the form",
      "add this boutique as a prospect",
      "which buyers are qualified?",
    ])("lights the CRM slice for: %s", (ask) => {
      const slice = selectAdminToolSlice(ask, ADMIN_MCP_TOOLS)
      expect(slice.domains).toContain("crm")
    })

    it("puts the lead list and the contact-create tool in the same slice", () => {
      // The whole point of the intake: read the leads, then promote one. If
      // these load separately every promotion costs an extra round trip.
      const slice = selectAdminToolSlice(
        "who came in from the ads and hasn't been contacted?",
        ADMIN_MCP_TOOLS
      )
      expect(slice.names).toContain("list_ad_leads")
      expect(slice.names).toContain("create_crm_contact")
      expect(slice.names).toContain("list_crm_contacts")
    })

    it.each([
      "did they ever reply?",
      "chase the ones who have gone quiet",
      "what have we said to this contact so far?",
      "log that I called them",
      "who should I follow up with on Tuesday?",
      "they asked to be taken off the list",
    ])("lights the CRM for conversation-axis asks: %s", (ask) => {
      // None of these name a CRM noun. Before the conversation keywords they
      // all fell through to the always-on slice, where no CRM tool exists.
      expect(selectAdminToolSlice(ask, ADMIN_MCP_TOOLS).domains).toContain("crm")
    })

    it("loads the timeline reader next to the activity writer", () => {
      const slice = selectAdminToolSlice(
        "what have we said to this contact so far?",
        ADMIN_MCP_TOOLS
      )
      expect(slice.names).toContain("list_crm_activities")
      expect(slice.names).toContain("log_crm_activity")
    })

    it("does not light the CRM for unrelated operational asks", () => {
      // A generous keyword list is fine; one that fires on everything is not.
      for (const ask of ["ship order_123 today", "how much yarn is left?"]) {
        expect(selectAdminToolSlice(ask, ADMIN_MCP_TOOLS).domains).not.toContain(
          "crm"
        )
      }
    })
  })

  describe("task templates reach the production slice", () => {
    // The dispatch vocabulary. Every run tool taking `template_names` needs a
    // name from here, and an invented one fails the dispatch with "Missing task
    // templates" — so if this tool is not loaded alongside them, the model has
    // no choice but to guess names it cannot see.
    it("classifies list_task_templates as production", () => {
      const byName = new Map(ADMIN_MCP_TOOLS.map((t) => [t.name, t]))
      expect(toolDomain(byName.get("list_task_templates")!)).toBe("production")
    })

    it.each([
      "send this partner's parked runs back to them",
      "re-dispatch the lapsed production runs",
      "what task templates do we have?",
      "which templates should this run be dispatched with?",
    ])("loads it next to the redispatch tool for: %s", (ask) => {
      const slice = selectAdminToolSlice(ask, ADMIN_MCP_TOOLS)
      expect(slice.names).toContain("list_task_templates")
    })

    it("loads templates and redispatch TOGETHER for a parked-run ask", () => {
      // Either one alone is a dead end: the names without the action, or the
      // action without any way to know a valid name.
      const slice = selectAdminToolSlice(
        "this partner will take their parked runs now, re-dispatch them",
        ADMIN_MCP_TOOLS
      )
      expect(slice.names).toContain("redispatch_parked_production_runs")
      expect(slice.names).toContain("list_task_templates")
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

  describe("bulk product editing reaches the catalog slice", () => {
    it("classifies bulk_update_products as catalog", () => {
      const byName = new Map(ADMIN_MCP_TOOLS.map((t) => [t.name, t]))
      expect(toolDomain(byName.get("bulk_update_products")!)).toBe("catalog")
    })

    // The tool lives under /admin/products and so classifies as catalog, but
    // the asks that need it are usually phrased in INVENTORY words. Each of
    // these would match only the inventory slice on its nouns alone, and the
    // one tool that can serve them would never load.
    it.each([
      "zero the stock on everything",
      "set stock to zero for all products",
      "start tracking stock on the whole range",
      "turn on manage inventory for every product",
      "bulk update these products and their variants",
    ])("activates it for: %s", (ask) => {
      const slice = selectAdminToolSlice(ask, ADMIN_MCP_TOOLS)
      expect(slice.names).toContain("bulk_update_products")
    })
  })

  describe("carrying a widened slice across turns", () => {
    // The slice is recomputed from keywords on every request and history
    // arrives text-only, so a domain the model bought with a load_admin_tools
    // round trip on turn N was gone on turn N+1 — the follow-up ask paid for
    // it again and burned one of the 8 steps.
    const loadPart = (domains: any, key: "input" | "output" = "input") => ({
      role: "assistant",
      parts: [{ type: "tool-load_admin_tools", [key]: { domains } }],
    })

    it("recovers the domains loaded on an earlier turn", () => {
      expect(widenedDomainsFromHistory([loadPart(["money"])])).toEqual(["money"])
      expect(
        widenedDomainsFromHistory([loadPart(["marketing"], "output")])
      ).toEqual(["marketing"])
    })

    it("reads dynamic-tool parts too", () => {
      expect(
        widenedDomainsFromHistory([
          {
            role: "assistant",
            parts: [
              {
                type: "dynamic-tool",
                toolName: "load_admin_tools",
                input: { domains: ["inventory"] },
              },
            ],
          },
        ])
      ).toEqual(["inventory"])
    })

    it("accepts only known domains, whatever the history claims", () => {
      expect(
        widenedDomainsFromHistory([
          loadPart(["money", "not_a_domain", "core", 42, null]),
        ])
      ).toEqual(["money"])
    })

    it("survives malformed or absent history without throwing", () => {
      expect(widenedDomainsFromHistory(undefined)).toEqual([])
      expect(widenedDomainsFromHistory([])).toEqual([])
      expect(widenedDomainsFromHistory([{ role: "user" }])).toEqual([])
      expect(
        widenedDomainsFromHistory([
          { role: "assistant", parts: [{ type: "text", text: "hi" }] },
        ])
      ).toEqual([])
      expect(widenedDomainsFromHistory([loadPart("money" as any)])).toEqual([])
    })

    it("ignores other tools' parts", () => {
      expect(
        widenedDomainsFromHistory([
          {
            role: "assistant",
            parts: [{ type: "tool-list_orders", input: { domains: ["money"] } }],
          },
        ])
      ).toEqual([])
    })

    it("what it recovers is exactly what the escape hatch would load", () => {
      // The carry-forward must be equivalent to re-calling load_admin_tools —
      // otherwise turn N+1 gets a subtly different surface from turn N.
      const carried = widenedDomainsFromHistory([loadPart(["money"])])
      expect(toolsInDomains(carried, ADMIN_MCP_TOOLS)).toEqual(
        toolsInDomains(["money"], ADMIN_MCP_TOOLS)
      )
    })

    it("every selectable domain survives a round trip through history", () => {
      for (const domain of SELECTABLE_DOMAINS) {
        expect(widenedDomainsFromHistory([loadPart([domain])])).toEqual([domain])
      }
    })
  })
})
