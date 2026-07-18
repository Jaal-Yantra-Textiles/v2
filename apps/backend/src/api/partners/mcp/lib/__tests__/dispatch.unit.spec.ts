import {
  buildToolInputSchema,
  dispatchPartnerTool,
  isSensitive,
} from "../dispatch"
import { PARTNER_MCP_TOOLS } from "../registry"

describe("partner-mcp registry + dispatch", () => {
  describe("create_store tool", () => {
    const def = PARTNER_MCP_TOOLS.find((t) => t.name === "create_store")

    it("is registered as a sensitive write on POST /partners/stores", () => {
      expect(def).toBeTruthy()
      expect(def!.method).toBe("POST")
      expect(def!.path).toBe("/partners/stores")
      expect(def!.write).toBe(true)
      expect(isSensitive(def!)).toBe(true)
      expect(def!.bodyParams).toEqual([
        "store",
        "sales_channel",
        "region",
        "location",
      ])
    })

    it("requires store, region and location in its schema", () => {
      expect(def!.inputSchema.required).toEqual(
        expect.arrayContaining(["store", "region", "location"])
      )
    })
  })

  describe("context framework arg", () => {
    it("is injected onto EVERY tool's input schema", () => {
      for (const def of PARTNER_MCP_TOOLS) {
        const schema = buildToolInputSchema(def)
        expect(schema.properties.context).toBeDefined()
        expect(schema.properties.context.type).toBe("string")
        expect(schema.properties.dry_run).toBeDefined()
      }
    })

    it("adds confirm only to sensitive tools", () => {
      const readTool = PARTNER_MCP_TOOLS.find((t) => t.name === "list_stores")!
      const sensitiveTool = PARTNER_MCP_TOOLS.find(
        (t) => t.name === "create_store"
      )!
      expect(buildToolInputSchema(readTool).properties.confirm).toBeUndefined()
      expect(
        buildToolInputSchema(sensitiveTool).properties.confirm
      ).toBeDefined()
    })

    it("echoes context on the dry-run plan of a read tool (no network)", async () => {
      const res = await dispatchPartnerTool(
        { baseUrl: "http://localhost:9999", bearer: "t", enableWrite: true },
        "list_stores",
        { dry_run: true, context: "checking stores before onboarding a partner" }
      )
      expect(res.ok).toBe(true)
      expect(res.dry_run).toBe(true)
      expect(res.plan?.context).toBe(
        "checking stores before onboarding a partner"
      )
    })
  })

  describe("registry integrity", () => {
    it("has unique tool names", () => {
      const names = PARTNER_MCP_TOOLS.map((t) => t.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it("every tool has a method and path, and every write is non-GET", () => {
      for (const t of PARTNER_MCP_TOOLS) {
        expect(t.path).toMatch(/^\/partners\//)
        if (t.write) expect(t.method).not.toBe("GET")
      }
    })

    it("covers the production workflow (designs, production runs, products, orders)", () => {
      const names = new Set(PARTNER_MCP_TOOLS.map((t) => t.name))
      for (const n of [
        "get_design", "update_design", "log_design_consumption",
        "recalculate_design_cost", "add_design_media",
        "log_production_run_consumption", "accept_production_run",
        "complete_production_run", "get_production_run_cost_summary",
        "create_product", "set_artisan_detail",
        "initiate_media_upload", "complete_media_upload",
        "get_order", "create_order_fulfillment", "mark_fulfillment_delivered",
      ]) {
        expect(names.has(n)).toBe(true)
      }
    })

    it("covers the broader dashboard reads (customers, payments, returns/claims/exchanges, inventory)", () => {
      const names = new Set(PARTNER_MCP_TOOLS.map((t) => t.name))
      for (const n of [
        "list_production_runs", "list_customers", "get_customer",
        "list_customer_groups", "get_payment", "list_payment_providers",
        "list_payment_submissions", "get_payment_submission",
        "list_returns", "get_return", "list_claims", "get_claim",
        "list_exchanges", "get_exchange", "get_inventory_item",
        "list_inventory_levels", "list_raw_materials",
        "get_partner_details", "list_currencies",
        "list_refund_reasons", "list_return_reasons",
      ]) {
        expect(names.has(n)).toBe(true)
      }
    })

    it("Tier 1 tools are all read-only (GET, non-write, non-sensitive)", () => {
      const tier1 = [
        "list_production_runs", "list_customers", "get_customer",
        "list_customer_groups", "get_payment", "list_payment_providers",
        "list_payment_submissions", "get_payment_submission",
        "list_returns", "get_return", "list_claims", "get_claim",
        "list_exchanges", "get_exchange", "get_inventory_item",
        "list_inventory_levels", "list_raw_materials",
        "get_partner_details", "list_currencies",
        "list_refund_reasons", "list_return_reasons",
      ]
        .map((n) => PARTNER_MCP_TOOLS.find((t) => t.name === n)!)
      for (const t of tier1) {
        expect(t.method).toBe("GET")
        expect(t.write).toBeFalsy()
        expect(isSensitive(t)).toBe(false)
      }
    })

    it("flags lifecycle/create writes as sensitive but not routine logging", () => {
      const byName = (n: string) => PARTNER_MCP_TOOLS.find((t) => t.name === n)!
      expect(isSensitive(byName("complete_production_run"))).toBe(true)
      expect(isSensitive(byName("create_product"))).toBe(true)
      expect(isSensitive(byName("create_order_fulfillment"))).toBe(true)
      // Routine consumption logging is a plain write, no confirmation friction.
      expect(isSensitive(byName("log_design_consumption"))).toBe(false)
      expect(isSensitive(byName("log_production_run_consumption"))).toBe(false)
    })

    it("covers storefront management (Tier 2) with reads + sensitive writes", () => {
      const names = new Set(PARTNER_MCP_TOOLS.map((t) => t.name))
      for (const n of [
        "get_storefront_status", "get_storefront_website",
        "update_storefront_website", "get_storefront_analytics",
        "update_storefront_analytics", "list_storefront_pages",
        "get_storefront_page", "list_storefront_page_blocks",
        "create_storefront_page", "update_storefront_page",
        "get_storefront_domain", "update_storefront_domain",
        "verify_storefront_domain", "provision_storefront",
        "redeploy_storefront", "seed_storefront_pages",
      ]) {
        expect(names.has(n)).toBe(true)
      }
      const byName = (n: string) => PARTNER_MCP_TOOLS.find((t) => t.name === n)!
      // Provisioning/redeploy/domain are high-stakes — must require confirmation.
      expect(isSensitive(byName("provision_storefront"))).toBe(true)
      expect(isSensitive(byName("redeploy_storefront"))).toBe(true)
      expect(isSensitive(byName("update_storefront_domain"))).toBe(true)
      expect(isSensitive(byName("verify_storefront_domain"))).toBe(true)
      expect(isSensitive(byName("seed_storefront_pages"))).toBe(true)
      // Routine page edits are writes but not sensitive (no confirmation friction).
      expect(isSensitive(byName("update_storefront_page"))).toBe(false)
      expect(byName("update_storefront_page").write).toBe(true)
    })

    it("covers store config (Tier 3) under /partners/stores/:id", () => {
      const names = new Set(PARTNER_MCP_TOOLS.map((t) => t.name))
      for (const n of [
        "get_store", "update_store", "list_store_regions", "get_store_region",
        "add_store_region", "update_store_region", "delete_store_region",
        "list_store_products", "get_store_product", "add_store_product",
        "update_store_product", "delete_store_product",
        "list_store_product_variants", "list_store_shipping_options",
        "add_store_shipping_option", "list_store_tax_regions",
        "add_store_tax_region", "list_store_sales_channels",
        "add_store_sales_channel", "list_store_locations",
        "add_store_location", "list_store_payment_providers",
      ]) {
        expect(names.has(n)).toBe(true)
      }
      const byName = (n: string) => PARTNER_MCP_TOOLS.find((t) => t.name === n)!
      // Deletes are implicitly sensitive (DELETE) — explicit assertions.
      expect(isSensitive(byName("delete_store_region"))).toBe(true)
      expect(isSensitive(byName("delete_store_product"))).toBe(true)
      // Routine store updates are plain writes with a previewPath.
      expect(isSensitive(byName("update_store"))).toBe(false)
      expect(byName("update_store").previewPath).toBe("/partners/stores/:id")
      expect(byName("update_store_region").write).toBe(true)
    })

    it("covers sensitive mutations (Tier 4): order/payment/task lifecycle", () => {
      const names = new Set(PARTNER_MCP_TOOLS.map((t) => t.name))
      for (const n of [
        "list_order_changes", "get_fulfillment_tracking",
        "list_assigned_tasks", "get_assigned_task",
        "cancel_order", "transfer_order", "cancel_fulfillment",
        "capture_payment", "refund_payment", "mark_payment_collection_paid",
        "request_order_edit", "confirm_order_edit",
        "accept_task", "finish_task",
      ]) {
        expect(names.has(n)).toBe(true)
      }
      const byName = (n: string) => PARTNER_MCP_TOOLS.find((t) => t.name === n)!
      // Money/order-reversing ops must require confirmation.
      expect(isSensitive(byName("cancel_order"))).toBe(true)
      expect(isSensitive(byName("transfer_order"))).toBe(true)
      expect(isSensitive(byName("cancel_fulfillment"))).toBe(true)
      expect(isSensitive(byName("capture_payment"))).toBe(true)
      expect(isSensitive(byName("refund_payment"))).toBe(true)
      expect(isSensitive(byName("mark_payment_collection_paid"))).toBe(true)
      expect(isSensitive(byName("confirm_order_edit"))).toBe(true)
      expect(isSensitive(byName("accept_task"))).toBe(true)
      // Opening an order edit / finishing a task are routine writes.
      expect(isSensitive(byName("request_order_edit"))).toBe(false)
      expect(isSensitive(byName("finish_task"))).toBe(false)
    })

    it("covers discovery + AI (Tier 5)", () => {
      const names = new Set(PARTNER_MCP_TOOLS.map((t) => t.name))
      for (const n of [
        "discover_products", "copy_discover_product",
        "get_ai_usage", "describe_image",
      ]) {
        expect(names.has(n)).toBe(true)
      }
      const byName = (n: string) => PARTNER_MCP_TOOLS.find((t) => t.name === n)!
      // Copying a discovered product into the partner's catalog is a
      // destructive create → require confirmation.
      expect(isSensitive(byName("copy_discover_product"))).toBe(true)
      // Discovery + usage are reads; describe_image is a write (not sensitive).
      expect(byName("discover_products").method).toBe("GET")
      expect(byName("get_ai_usage").method).toBe("GET")
      expect(byName("describe_image").write).toBe(true)
      expect(isSensitive(byName("describe_image"))).toBe(false)
    })

    it("covers inventory orders (Tier 6) — raw-material purchase-order lifecycle", () => {
      const names = new Set(PARTNER_MCP_TOOLS.map((t) => t.name))
      for (const n of [
        "list_inventory_orders", "get_inventory_order",
        "start_inventory_order", "submit_inventory_order_payment",
        "get_inventory_order_shiprocket_rates",
        "get_inventory_order_fulfillment_rates",
        "ready_inventory_order_for_delivery",
        "create_inventory_order_shipment",
        "complete_inventory_order",
      ]) {
        expect(names.has(n)).toBe(true)
      }
      const byName = (n: string) => PARTNER_MCP_TOOLS.find((t) => t.name === n)!
      // Money/reversal/state-changing ops require confirmation.
      expect(isSensitive(byName("submit_inventory_order_payment"))).toBe(true)
      expect(isSensitive(byName("ready_inventory_order_for_delivery"))).toBe(true)
      expect(isSensitive(byName("create_inventory_order_shipment"))).toBe(true)
      expect(isSensitive(byName("complete_inventory_order"))).toBe(true)
      // Start is a routine state advance (no money).
      expect(isSensitive(byName("start_inventory_order"))).toBe(false)
      expect(byName("start_inventory_order").write).toBe(true)
      // Rates are reads.
      expect(byName("get_inventory_order_shiprocket_rates").method).toBe("GET")
      expect(byName("get_inventory_order_fulfillment_rates").method).toBe("GET")
    })
  })

  it("returns a soft error for an unknown tool", async () => {
    const res = await dispatchPartnerTool(
      { baseUrl: "http://localhost:9999" },
      "does_not_exist",
      {}
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/unknown tool/i)
  })
})
