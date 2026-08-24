import {
  selectPartnerToolSlice,
  matchDomains,
  toolDomain,
  toolRouteFamily,
  toolsInDomains,
  widenedDomainsFromHistory,
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

    it("classifies store PRODUCTS as catalog, and store CONFIG as storefront", () => {
      // Store products live under /partners/stores/:id/products, but a partner
      // asks for them in product words ("update the price of my product"), never
      // store words — so they classify with the rest of the catalog. Route shape
      // and vocabulary part company here; vocabulary wins, because a domain is
      // only useful if the words for a tool select the domain that OWNS it.
      const byName = new Map(PARTNER_MCP_TOOLS.map((t) => [t.name, t]))
      expect(toolDomain(byName.get("bulk_update_products")!)).toBe("catalog")
      expect(toolDomain(byName.get("update_store_product")!)).toBe("catalog")
      expect(toolDomain(byName.get("list_store_product_variants")!)).toBe("catalog")
      expect(toolDomain(byName.get("list_missing_hs_codes")!)).toBe("catalog")
      expect(toolDomain(byName.get("create_product")!)).toBe("catalog")
      expect(toolDomain(byName.get("list_product_categories")!)).toBe("catalog")

      // The same reasoning routes two more store sub-trees by meaning: a store
      // "location" is a stock location, and payment providers are money.
      expect(toolDomain(byName.get("add_store_location")!)).toBe("inventory")
      expect(toolDomain(byName.get("list_store_payment_providers")!)).toBe("money")

      // What remains under /partners/stores is genuine store CONFIGURATION.
      expect(toolDomain(byName.get("add_store_sales_channel")!)).toBe("storefront")
      expect(toolDomain(byName.get("add_store_shipping_option")!)).toBe("storefront")
      expect(toolDomain(byName.get("add_store_tax_region")!)).toBe("storefront")
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

    describe("carrying a widened slice across turns", () => {
      const loadPart = (domains: any, key: "input" | "output" = "input") => ({
        role: "assistant",
        parts: [{ type: "tool-load_partner_tools", [key]: { domains } }],
      })

      it("recovers the domains loaded on an earlier turn", () => {
        expect(widenedDomainsFromHistory([loadPart(["money"])])).toEqual(["money"])
        expect(
          widenedDomainsFromHistory([loadPart(["designs"], "output")])
        ).toEqual(["designs"])
      })

      it("reads dynamic-tool parts too", () => {
        expect(
          widenedDomainsFromHistory([
            {
              role: "assistant",
              parts: [
                {
                  type: "dynamic-tool",
                  toolName: "load_partner_tools",
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
        expect(
          widenedDomainsFromHistory([loadPart("money" as any)])
        ).toEqual([])
      })

      it("ignores other tools' parts", () => {
        expect(
          widenedDomainsFromHistory([
            {
              role: "assistant",
              parts: [
                { type: "tool-list_orders", input: { domains: ["money"] } },
              ],
            },
          ])
        ).toEqual([])
      })

      it("what it recovers is exactly what the escape hatch would load", () => {
        // The carry-forward must be equivalent to re-calling load_partner_tools
        // — otherwise turn N+1 gets a subtly different surface from turn N.
        const carried = widenedDomainsFromHistory([loadPart(["money"])])
        expect(toolsInDomains(carried, PARTNER_MCP_TOOLS)).toEqual(
          toolsInDomains(["money"], PARTNER_MCP_TOOLS)
        )
      })
    })
  })

  describe("bulk store-product edits reach the slice", () => {
    // The asks that need bulk_update_products are phrased in bulk/product
    // words. Without matching keywords the one tool that can serve them never
    // loads — the partner would be told "impossible".
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

  /**
   * Vocabulary coverage — the invariant the orphan test does NOT give you.
   *
   * Classifying a tool only proves it BELONGS somewhere; it says nothing about
   * whether any phrasing a partner would use selects that somewhere. Every bug
   * found in review was of that shape: `variant`/`sku` pointed at a domain with
   * no variant tools, and the customs / shipping-option / sales-channel tools
   * had no activating words at all — all while the orphan test stayed green.
   *
   * So: one realistic ask per ROUTE FAMILY, asserting the family's tools are
   * actually in the resulting slice. A new route family fails here until it has
   * both a prefix and words a partner would type.
   */
  describe("vocabulary coverage", () => {
    /** Realistic ask -> the route family it must reach. Core is always on. */
    const FAMILY_ASKS: Record<string, string> = {
      "/partners/orders": "show me my open orders",
      "/partners/order-edits": "request an order edit for this one",
      "/partners/returns": "create a return for this order",
      "/partners/claims": "is there a claim open on this order",
      "/partners/exchanges": "any exchanges open on this order",
      "/partners/refund-reasons": "what refund reasons can I pick from",
      "/partners/return-reasons": "what return reasons can I pick from",
      "/partners/products": "create a product",
      "/partners/product-categories": "create a product category",
      "/partners/product-collections": "add this to a product collection",
      "/partners/product-tags": "list my product tags",
      "/partners/product-types": "create a product type",
      "/partners/price-preferences": "set a price preference",
      // Phrased the way a partner actually asks — in colour words, not in
      // "option palette" ones. The palette is the vocabulary
      // `add_product_option` must be called with, so this ask has to load it.
      "/partners/option-palettes": "what colours can I offer on this product",
      "/partners/discover": "discover products I can copy into my catalogue",
      "/partners/stores/:id/products": "update the price of my product to 2400",
      "/partners/stores/:id/product-variants": "list my product variants",
      "/partners/stores/:id/customs":
        "which of my products are missing HS codes?",
      "/partners/stores": "add a sales channel and a tax region to my store",
      "/partners/storefront": "redeploy my storefront website",
      "/partners/designs": "update the tech pack on this design",
      "/partners/production-runs": "accept the production run",
      "/partners/tasks": "finish the task I was assigned",
      "/partners/assigned-tasks": "what tasks am I assigned",
      "/partners/inventory-items": "how much stock is on this inventory item",
      "/partners/inventory-orders": "raise an inventory order for more fabric",
      "/partners/reservations": "list the stock reservations",
      "/partners/stores/:id/locations": "add a warehouse location",
      "/partners/customers": "show me my customers",
      "/partners/customer-groups": "list my customer groups",
      "/partners/payments": "refund this payment",
      "/partners/payment-providers": "which payment providers are available",
      "/partners/payment-submissions": "list my payment submissions",
      "/partners/payment-collections": "mark this payment collection as paid",
      "/partners/stores/:id/payment-providers":
        "which payment providers are enabled for my store",
      // B2B quotes (#1439). Phrased as a partner would actually ask it, not as
      // a keyword list — the point of this table is that the real sentence
      // reaches the tools.
      "/partners/quotes": "send this buyer a quote for 200 shawls",
    }

    const familiesInRegistry = [
      ...new Set(
        PARTNER_MCP_TOOLS.map((t) => toolRouteFamily(t)).filter(
          // Native (pathless) tools ride the always-on core.
          (f) => f !== "native"
        )
      ),
    ]
      // Core families are in every slice by construction, so they need no ask.
      .filter(
        (f) =>
          !PARTNER_MCP_TOOLS.some(
            (t) => toolRouteFamily(t) === f && toolDomain(t) === "core"
          )
      )
      .sort()

    it("every route family has an ask that reaches it", () => {
      const missing = familiesInRegistry.filter((f) => !FAMILY_ASKS[f])
      expect(missing).toEqual([])
    })

    it.each(familiesInRegistry)(
      "an ordinary ask loads every tool in %s",
      (family) => {
        const ask = FAMILY_ASKS[family]
        const slice = selectPartnerToolSlice(ask, PARTNER_MCP_TOOLS)
        const unreachable = PARTNER_MCP_TOOLS.filter(
          (t) => toolRouteFamily(t) === family && !slice.names.includes(t.name)
        ).map((t) => t.name)
        expect({ family, ask, unreachable }).toEqual({
          family,
          ask,
          unreachable: [],
        })
      }
    )

    // The four activation bugs found in review, by their exact phrasings.
    it.each([
      ["list my product variants", "list_store_product_variants"],
      ["update the price of my product to 2400", "update_store_product"],
      ["which of my products are missing HS codes?", "list_missing_hs_codes"],
      ["set the hsn code for my sarees", "bulk_set_hs_codes"],
      ["what shipping options do I offer", "list_store_shipping_options"],
      ["add a sales channel", "add_store_sales_channel"],
      ["add a warehouse location", "add_store_location"],
      ["add a tax region for karnataka", "add_store_tax_region"],
    ])("%s -> offers %s", (ask, toolName) => {
      const slice = selectPartnerToolSlice(ask, PARTNER_MCP_TOOLS)
      expect(slice.names).toContain(toolName)
    })

    it("keeps slices focused — no ask drags in the whole registry", () => {
      for (const ask of Object.values(FAMILY_ASKS)) {
        const slice = selectPartnerToolSlice(ask, PARTNER_MCP_TOOLS)
        expect({ ask, tooBig: slice.names.length > PARTNER_MCP_TOOLS.length / 2 })
          .toEqual({ ask, tooBig: false })
      }
    })
  })
})
