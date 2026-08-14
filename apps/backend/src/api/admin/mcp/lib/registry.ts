/**
 * Declarative registry of Admin API endpoints exposed as MCP / chat tools.
 *
 * Each entry maps one tool -> one `/admin/*` route. The shared mcp-core
 * dispatcher (see lib/mcp-core) is a thin loopback proxy: it forwards the tool
 * arguments to the real admin route, so every tool inherits the route's admin
 * authentication, `validateAndTransformBody` validators, and workflow logic —
 * for free. Wrapping a new endpoint is one row.
 *
 * Three safety rails the dispatcher enforces from these flags:
 *  - `dry_run` (every tool): preview the planned request — and, for writes with
 *    a `previewPath`, the current object — WITHOUT executing.
 *  - `sensitive` (+ every DELETE): require `confirm: true`.
 *  - `dangerous` (platform-destructive): additionally require a human `reason`;
 *    hidden + refused unless ADMIN_MCP_ENABLE_DANGEROUS is on.
 *
 * Tier 1 is read-only breadth. Tier 2 adds the first writes — catalog updates
 * (sensitive: require confirm) and the first `dangerous` action (delete_product:
 * confirm + reason, gated by ADMIN_MCP_ENABLE_DANGEROUS) — plus the
 * MCP-observability read (`get_mcp_usage`) and the resolver capability carried
 * over from the deprecated V4 chat (`resolve_admin_query`). Tier 3 covers
 * partner ops (#843) and then the three operational domains behind it:
 * orders/fulfillment + order edits (#1165), production-run lifecycle (#1167)
 * and the design -> production pipeline (#1166). Remaining uncovered domains
 * are catalogued in #1168 — add them as real demand appears, not ahead of it:
 * every row here is bound into EVERY admin-assistant turn, so the registry's
 * size is a per-request token cost.
 */
import type { McpToolDef } from "../../../../lib/mcp-core"

/** Admin tool definition. Alias of the shared core tool model. */
export type AdminMcpToolDef = McpToolDef

export { renderToolGuidance } from "../../../../lib/mcp-core"

// ---- Reusable JSON-Schema fragments ---------------------------------------

const STR = (description: string) => ({ type: "string", description })
const BOOL = (description: string) => ({ type: "boolean", description })
const INT = (description: string) => ({ type: "integer", description })

const obj = (
  properties: Record<string, any>,
  required: string[] = []
): Record<string, any> => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})

/** Pagination props shared by list tools. */
const PAGINATION = {
  limit: { type: "integer", description: "Max results (default 20)." },
  offset: { type: "integer", description: "Pagination offset." },
  q: { type: "string", description: "Free-text search filter." },
} as const

export const ADMIN_MCP_TOOLS: AdminMcpToolDef[] = [
  // ===== Grounding =========================================================
  {
    name: "get_admin_stats",
    description:
      "Get a high-level snapshot of the platform: counts of orders, products, partners, designs, production runs and stores. Call this FIRST to ground yourself before answering operational questions.",
    method: "GET",
    path: "/admin/mcp/stats",
    inputSchema: obj({}),
  },

  // ===== Orders ============================================================
  {
    name: "list_orders",
    description:
      "List orders (paginated). Supports free-text search via q. Defaults to RETAIL orders only — pass kind to see design/inventory orders or all of them. Use to answer 'what orders came in', revenue/volume, and to find an order id.",
    method: "GET",
    path: "/admin/orders",
    queryParams: ["limit", "offset", "q", "status", "kind", "sales_channel_id", "region_id", "customer_id"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional order status filter."),
      kind: STR(
        "Which order family to list: 'retail' (default) | 'design' | 'inventory' | 'all'."
      ),
      sales_channel_id: STR("Filter to orders in a specific sales channel id."),
      region_id: STR("Filter to orders in a specific region id."),
      customer_id: STR("Filter to orders for a specific customer id."),
    }),
  },
  {
    name: "get_order",
    description: "Get a single order by id (line items, totals, fulfillment, payment status).",
    method: "GET",
    path: "/admin/orders/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Order id, e.g. 'order_...'.") }, ["id"]),
  },

  // ===== Catalog ===========================================================
  {
    name: "list_products",
    description:
      "List products (paginated). Supports free-text search via q. Filter by status, sales channel, collection, category, type, tag or handle to scope results — e.g. pass sales_channel_id to see products in a partner's storefront, or status=published to see only live products.",
    method: "GET",
    path: "/admin/products",
    queryParams: ["limit", "offset", "q", "status", "sales_channel_id", "collection_id", "category_id", "type_id", "tag_id", "handle"],
    inputSchema: obj({
      ...PAGINATION,
      status: {
        type: "string",
        description: "Product status: 'draft' | 'proposed' | 'published' | 'rejected'.",
      },
      sales_channel_id: STR("Filter to products in a specific sales channel id (e.g. a partner store's default_sales_channel_id from list_stores)."),
      collection_id: STR("Filter to products in a specific collection."),
      category_id: STR("Filter to products in a specific category."),
      type_id: STR("Filter to products of a specific type."),
      tag_id: STR("Filter to products with a specific tag."),
      handle: STR("Filter to a product by its URL handle."),
    }),
  },
  {
    name: "get_product",
    description: "Get a single product by id (variants, options, status).",
    method: "GET",
    path: "/admin/products/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Product id, e.g. 'prod_...'.") }, ["id"]),
  },

  // ===== Customers =========================================================
  {
    name: "list_customers",
    description:
      "List customers (paginated). Supports free-text search via q. Filter by email, name, company or account type.",
    method: "GET",
    path: "/admin/customers",
    queryParams: ["limit", "offset", "q", "email", "has_account", "company_name", "first_name", "last_name"],
    inputSchema: obj({
      ...PAGINATION,
      email: STR("Filter to customers with a specific email."),
      has_account: BOOL("Filter to registered (true) or guest (false) customers."),
      company_name: STR("Filter by company name."),
      first_name: STR("Filter by first name."),
      last_name: STR("Filter by last name."),
    }),
  },

  // ===== Partners & stores =================================================
  {
    name: "list_partners",
    description:
      "List partners (sellers, manufacturers, makers, designers). Supports free-text search via q. Use to find a partner id or review onboarding status.",
    method: "GET",
    path: "/admin/partners",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "get_partner",
    description: "Get a single partner by id (profile, handle, workspace_type, status, metadata).",
    method: "GET",
    path: "/admin/partners/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
  },
  {
    name: "list_partner_products",
    description:
      "List a specific partner's products — the sales-channel-scoped catalog that partner sees on their own portal. Use list_stores or get_partner to find the partner's stores first, then pass store_id to scope to a specific storefront. Without store_id, the partner's first store is used.",
    method: "GET",
    path: "/admin/partners/:id/products",
    pathParams: ["id"],
    queryParams: ["store_id", "q", "limit", "offset"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        store_id: STR("Optional store id to scope to a specific storefront. Defaults to the partner's first store."),
        ...PAGINATION,
      },
      ["id"]
    ),
  },
  {
    name: "list_stores",
    description: "List storefronts / stores configured on the platform.",
    method: "GET",
    path: "/admin/stores",
    queryParams: ["limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },

  // ===== Designs & production ==============================================
  {
    name: "list_designs",
    description:
      "List designs (paginated). Supports free-text search via q. Filter by status, design type, priority, partner or tags.",
    method: "GET",
    path: "/admin/designs",
    queryParams: ["limit", "offset", "q", "status", "design_type", "priority", "partner_id", "tags", "name"],
    inputSchema: obj({
      ...PAGINATION,
      name: STR("Partial or full name match."),
      status: {
        type: "string",
        description: "Design status: 'Conceptual' | 'In_Development' | 'Technical_Review' | 'Sample_Production' | 'Revision' | 'Approved' | 'Rejected' | 'On_Hold' | 'Commerce_Ready' | 'Superseded'.",
      },
      design_type: {
        type: "string",
        description: "'Original' | 'Derivative' | 'Custom' | 'Collaboration'.",
      },
      priority: {
        type: "string",
        description: "'Low' | 'Medium' | 'High' | 'Urgent'.",
      },
      partner_id: STR("Filter by owning partner id."),
      tags: {
        type: "array",
        description: "Tag strings to filter by.",
        items: { type: "string" },
      },
    }),
  },
  {
    name: "get_design",
    description: "Get a single design by id (status, sizes, linked product, metadata).",
    method: "GET",
    path: "/admin/designs/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Design id, e.g. 'design_...'.") }, ["id"]),
  },
  {
    name: "list_production_runs",
    description:
      "List production runs / work orders (paginated). Free-text search via q (matches run id and the design, partner or product the run is for). Filter by status, partner, design, product, order, run type or parent run. Use to see open runs, their stage and assigned partner.",
    method: "GET",
    path: "/admin/production-runs",
    // `q` was withheld here until #1172 — the route accepted the param but never
    // read it, so declaring it silently dropped the model's search term.
    queryParams: [
      "limit",
      "offset",
      "q",
      "status",
      "partner_id",
      "design_id",
      "product_id",
      "order_id",
      "parent_run_id",
      "run_type",
      "include_tasks",
    ],
    inputSchema: obj({
      limit: { type: "integer", description: "Max results (default 20)." },
      offset: { type: "integer", description: "Pagination offset." },
      q: STR(
        "Free-text search over the run id and the name of the design, partner or product the run is for."
      ),
      status: STR(
        "Run status: 'draft' | 'pending_review' | 'approved' | 'sent_to_partner' | 'in_progress' | 'completed' | 'cancelled' | 'awaiting_reassignment'."
      ),
      partner_id: STR("Only runs assigned to this partner."),
      design_id: STR("Only runs for this design."),
      product_id: STR("Only runs for this product."),
      order_id: STR("Only runs for this order."),
      parent_run_id: STR("Only child runs of this parent run."),
      run_type: STR("'production' | 'sample'."),
      include_tasks: STR("Pass 'true' to include each run's tasks."),
    }),
  },

  // ===== Inventory =========================================================
  {
    name: "list_inventory_items",
    description: "List inventory items (paginated). Supports free-text search via q.",
    method: "GET",
    path: "/admin/inventory-items",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "list_inventory_orders",
    description:
      "List inventory orders (raw-material purchase orders / stock movements), paginated.",
    method: "GET",
    path: "/admin/inventory-orders",
    queryParams: ["limit", "offset", "q", "status"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional status filter."),
    }),
  },

  // ===== Money =============================================================
  {
    name: "list_payments",
    description:
      "List payments / payout records (paginated). Read-only view of money movement; settling is a later, dangerous tier.",
    method: "GET",
    path: "/admin/payments",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },

  // ===== Marketing & analytics ============================================
  {
    name: "list_publishing_campaigns",
    description: "List publishing / newsletter campaigns (paginated).",
    method: "GET",
    path: "/admin/publishing-campaigns",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "list_notifications",
    description: "List platform notifications (paginated). Use to review recent system events.",
    method: "GET",
    path: "/admin/notifications",
    queryParams: ["limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },

  // ===== Observability (#844) =============================================
  {
    name: "get_mcp_usage",
    description:
      "Read the MCP observability ledger: totals plus per-surface and per-tool counts, error count, and the most recent tool calls across the store/partner/admin MCP surfaces. Use to answer 'how is the MCP being used' or 'what's failing'.",
    method: "GET",
    path: "/admin/mcp/usage",
    queryParams: ["surface", "limit"],
    inputSchema: obj({
      surface: STR("Optional surface filter: 'store' | 'partner' | 'admin'."),
      limit: { type: "integer", description: "Max rows to scan (default 50, max 200)." },
    }),
  },

  // ===== Assistant capability (carried over from the deprecated V4 chat) ===
  {
    name: "resolve_admin_query",
    description:
      "Resolve a natural-language question about the platform's data/code into an execution plan (hybrid BM25 code search + LLM). This is the query-resolution capability from the retired V4 admin chat. Read-only: it plans, it does not mutate anything.",
    method: "POST",
    path: "/admin/mcp/resolve-query",
    bodyParams: ["query"],
    inputSchema: obj(
      { query: STR("The natural-language query to resolve into an execution plan.") },
      ["query"]
    ),
  },

  // ===== Tier 2: catalog writes ==========================================
  // Writes are gated by ADMIN_MCP_ENABLE_WRITE (default on) and flagged
  // `sensitive` so the dispatcher requires the admin's explicit confirm:true.
  // Each declares a previewPath so dry_run / the confirmation card can show the
  // current object before the change. They wrap Medusa's built-in admin routes.
  {
    name: "create_product",
    description:
      "Create a new product. Sensitive: requires confirm:true. Prefer dry_run first to review the payload.",
    method: "POST",
    path: "/admin/products",
    write: true,
    sensitive: true,
    bodyParams: ["title", "status", "description", "subtitle", "handle", "metadata"],
    inputSchema: obj(
      {
        title: STR("Product title (required)."),
        status: STR("Product status: 'draft' | 'proposed' | 'published' | 'rejected'."),
        description: STR("Product description."),
        subtitle: STR("Optional subtitle."),
        handle: STR("Optional URL handle (auto-derived from title if omitted)."),
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["title"]
    ),
    sideEffects: "Creates a new product in 'draft' status unless status is set.",
    nextSteps: ["get_product", "update_product"],
  },
  {
    name: "update_product",
    description:
      "Update an existing product (title, status, description, handle, metadata). Sensitive: requires confirm:true. Use dry_run to see the current product first.",
    method: "POST",
    path: "/admin/products/:id",
    pathParams: ["id"],
    previewPath: "/admin/products/:id",
    write: true,
    sensitive: true,
    bodyParams: ["title", "status", "description", "subtitle", "handle", "metadata"],
    inputSchema: obj(
      {
        id: STR("Product id, e.g. 'prod_...'."),
        title: STR("New title."),
        status: STR("New status: 'draft' | 'proposed' | 'published' | 'rejected'."),
        description: STR("New description."),
        subtitle: STR("New subtitle."),
        handle: STR("New URL handle."),
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id"]
    ),
    sideEffects: "Publishing a product makes it live on the storefront.",
  },
  {
    name: "bulk_update_products",
    description: [
      "Update MANY products, their variants and their stock levels in one call. Sensitive: requires confirm:true. ALWAYS dry_run first — the plan names every product and variant it would touch, with the before/after quantity at each location, and there is no undo once it fires.",
      "Returns a PER-ROW outcome: one bad id never discards the rest of the batch, so read `variants`, `products` and `warnings` rather than just the status.",
      "",
      "TARGETING — combine freely:",
      "- `products: [{ product_id, update, variants }]` for named products. Omit a product's `variants` key to mean EVERY variant of it.",
      "- `selector` for filter-based batches: `{ all: true }`, `collection_id`, `category_id`, `status`, `product_ids`. This is how 'zero the whole catalogue' is one call. `all: true` must be passed explicitly — the selector will not default to everything.",
      "- `product_update` / `variant_update` apply to everything selected; a per-row `update` wins over them.",
      "",
      "INVENTORY — `set_inventory: { quantity, ensure_managed, location_ids }`:",
      "- `quantity` is ABSOLUTE, not a delta. 0 zeroes the stock.",
      "- 🔑 `ensure_managed: true` is what makes this work on untracked variants. Medusa CANNOT turn inventory tracking on for a variant that already exists — core only ever turns it off — so a variant with `manage_inventory: false` has no inventory item and nothing to stock. With this flag the tool creates the inventory item, links it to the variant, seeds the levels, then writes the quantity. Without it, untracked variants come back `skipped` and their stock is untouched.",
      "- `location_ids` defaults to every location on the scoping sales channel.",
      "",
      "⚠️ `manage_inventory: false` is REFUSED here. Core dismisses the variant's inventory item and its levels with it, with no undo, so it is not something to do to a whole selector. Use `update_product_variant` one variant at a time.",
      "Capped at 200 products per call.",
    ].join("\n"),
    method: "POST",
    path: "/admin/products/bulk-update",
    write: true,
    sensitive: true,
    bodyParams: [
      "products",
      "selector",
      "product_update",
      "variant_update",
      "set_inventory",
      "dry_run",
    ],
    inputSchema: obj({
      products: {
        type: "array",
        description:
          "Named products. Omit a row's `variants` to target every variant of it.",
        items: {
          type: "object",
          properties: {
            product_id: STR("Product id, e.g. 'prod_...'."),
            update: {
              type: "object",
              description:
                "Product fields to change (title, subtitle, description, handle, status, material, hs_code, weight, metadata, …).",
              additionalProperties: true,
            },
            variants: {
              type: "array",
              description:
                "Specific variants only. Omit the key entirely to mean all of them.",
              items: {
                type: "object",
                properties: {
                  variant_id: STR("Variant id, e.g. 'variant_...'."),
                  update: {
                    type: "object",
                    description:
                      "Variant fields to change (title, sku, hs_code, origin_country, material, allow_backorder, weight, metadata, …).",
                    additionalProperties: true,
                  },
                },
                required: ["variant_id"],
                additionalProperties: false,
              },
            },
          },
          required: ["product_id"],
          additionalProperties: false,
        },
      },
      selector: {
        type: "object",
        description:
          "Filter-based targeting. Must narrow something; pass all: true to mean the whole catalogue.",
        properties: {
          all: BOOL("Every product in scope. Say this explicitly."),
          product_ids: { type: "array", items: { type: "string" }, description: "Specific product ids." },
          collection_id: { type: "array", items: { type: "string" }, description: "Restrict to these collections." },
          category_id: { type: "array", items: { type: "string" }, description: "Restrict to these categories." },
          status: { type: "array", items: { type: "string" }, description: "Restrict to these product statuses." },
        },
        additionalProperties: false,
      },
      product_update: {
        type: "object",
        description: "Product fields applied to every selected product.",
        additionalProperties: true,
      },
      variant_update: {
        type: "object",
        description:
          "Variant fields applied to every selected variant. manage_inventory: false is refused.",
        additionalProperties: true,
      },
      set_inventory: {
        type: "object",
        description: "Stock to write on every selected variant.",
        properties: {
          quantity: INT("Absolute on-hand quantity. NOT a delta; 0 zeroes it."),
          ensure_managed: BOOL(
            "Turn inventory tracking on where it is off, creating the inventory item, link and levels core never makes for an existing variant. Untracked variants are skipped without this."
          ),
          location_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Stock locations to write. Defaults to every location on the sales channel.",
          },
        },
        required: ["quantity"],
        additionalProperties: false,
      },
      dry_run: BOOL("Return the plan without writing. Do this first."),
    }),
    sideEffects:
      "Overwrites live catalogue fields and on-hand stock across many products at once. Enabling tracking creates inventory items and levels. Setting a quantity below a variant's reserved stock oversells open orders — the response warns, it does not block.",
    nextSteps: ["list_products", "get_product"],
  },
  // ===== Customs / HS codes ===============================================
  // Shiprocket rejects EVERY international shipment whose lines lack an HSN,
  // and the manual fix is one variant at a time. These two make it a bulk job.
  {
    name: "list_missing_hs_codes",
    description:
      "List catalogue items that have NO HS/HSN customs code at any level and would therefore fail an international shipping label. Each row carries the product title, description, material, type and categories so you can propose an accurate code, plus `suggested_target` telling you exactly which level and id to write it to. Read-only.",
    method: "GET",
    path: "/admin/customs/hs-codes/missing",
    queryParams: ["limit", "offset"],
    inputSchema: obj({
      limit: { type: "integer", description: "Max products to scan (default 50, max 200)." },
      offset: { type: "integer", description: "Pagination offset over products." },
    }),
    nextSteps: ["bulk_set_hs_codes"],
  },
  {
    name: "bulk_set_hs_codes",
    description: [
      "Assign HS/HSN customs codes to many catalogue items in one call. Sensitive: requires confirm:true. Use dry_run first to review the batch. Returns a PER-ROW outcome — a bad id never discards the rest of the batch, so read `results`, not just the status.",
      "",
      "WHERE to write a code matters: a label reads the levels in a fixed order (variant → the variant's inventory item → the product), so a code written at the wrong level is invisible to it.",
      "- Variant manages its own inventory → write at `inventory_item`.",
      "- Product HAS variants but none of them manage inventory → write at `product`. The code then covers every sibling variant at once; writing per-variant there means N rows to maintain and N chances for one to drift.",
      "- Write at `variant` only when one specific variant genuinely differs from its siblings.",
      "`list_missing_hs_codes` already computes this for you as `suggested_target` — prefer it over deciding yourself.",
      "",
      "NEVER guess a code from an id or a SKU. Classify from the product title, description, material and category. If those don't identify the goods well enough, say so and ask — this is a customs declaration, and a wrong one is a misdeclaration.",
    ].join("\n"),
    method: "POST",
    path: "/admin/customs/hs-codes",
    write: true,
    sensitive: true,
    bodyParams: ["assignments"],
    inputSchema: obj(
      {
        assignments: {
          type: "array",
          description: "The codes to write (max 200 per call).",
          items: {
            type: "object",
            properties: {
              level: {
                type: "string",
                enum: ["variant", "inventory_item", "product"],
                description: "Which catalogue level to write the code to.",
              },
              id: STR("Id of the variant / inventory item / product."),
              hs_code: STR(
                "The HS/HSN code. 6 digits internationally; India's HSN runs to 8 and some tariff lines to 10."
              ),
              origin_country: STR("Optional ISO-2 country of manufacture."),
              material: STR("Optional material description for customs."),
            },
            required: ["level", "id", "hs_code"],
            additionalProperties: false,
          },
        },
      },
      ["assignments"]
    ),
    sideEffects:
      "Writes customs codes onto live catalogue records. Labels resolve HSN from the DB at generation time, so this immediately affects EXISTING orders too — no backfill needed.",
  },
  {
    name: "update_product_variant",
    description:
      "Update a single product variant (sku, title, customs fields, inventory flags). Sensitive: requires confirm:true. For filling HS codes across many items use bulk_set_hs_codes instead.",
    method: "POST",
    path: "/admin/products/:product_id/variants/:id",
    pathParams: ["product_id", "id"],
    previewPath: "/admin/products/:product_id/variants/:id",
    write: true,
    sensitive: true,
    bodyParams: [
      "title",
      "sku",
      "hs_code",
      "origin_country",
      "material",
      "manage_inventory",
      "allow_backorder",
      "metadata",
    ],
    inputSchema: obj(
      {
        product_id: STR("Product id, e.g. 'prod_...'."),
        id: STR("Variant id, e.g. 'variant_...'."),
        title: STR("New variant title."),
        sku: STR("New SKU."),
        hs_code: STR("HS/HSN customs code."),
        origin_country: STR("ISO-2 country of manufacture."),
        material: STR("Material description."),
        manage_inventory: { type: "boolean", description: "Track stock for this variant." },
        allow_backorder: { type: "boolean", description: "Allow ordering beyond stock." },
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["product_id", "id"]
    ),
  },
  {
    name: "update_customer",
    description:
      "Update a customer's profile (name, email, phone, company, metadata). Sensitive: requires confirm:true. Use dry_run to see the current customer first.",
    method: "POST",
    path: "/admin/customers/:id",
    pathParams: ["id"],
    previewPath: "/admin/customers/:id",
    write: true,
    sensitive: true,
    bodyParams: ["first_name", "last_name", "email", "phone", "company_name", "metadata"],
    inputSchema: obj(
      {
        id: STR("Customer id, e.g. 'cus_...'."),
        first_name: STR("First name."),
        last_name: STR("Last name."),
        email: STR("Email address."),
        phone: STR("Phone number."),
        company_name: STR("Company name."),
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id"]
    ),
  },

  // ===== Partner ops (#843): inspect + act on a partner's sub-resources ===
  // These wrap ALREADY-EXISTING /admin/partners/:id/* routes — no new backend
  // surface, just registry rows exposing what admins can already do via the
  // partner detail page as chat-invokable tools (read + write).
  {
    name: "list_partner_tasks",
    description: "List all tasks assigned to a partner.",
    method: "GET",
    path: "/admin/partners/:id/tasks",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
  },
  {
    name: "get_partner_task",
    description: "Get a single task assigned to a partner by task id.",
    method: "GET",
    path: "/admin/partners/:id/tasks/:taskId",
    pathParams: ["id", "taskId"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        taskId: STR("Task id, e.g. 'task_...'."),
      },
      ["id", "taskId"]
    ),
  },
  {
    name: "list_partner_feedbacks",
    description: "List feedback entries linked to a partner.",
    method: "GET",
    path: "/admin/partners/:id/feedbacks",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
  },
  {
    name: "list_partner_people",
    description: "List persons (contacts) linked to a partner.",
    method: "GET",
    path: "/admin/partners/:id/people",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
  },
  {
    name: "get_partner_fees",
    description:
      "Get a partner's transaction-fee (commission) ledger and roll-up summary (totals, by-status, by-currency).",
    method: "GET",
    path: "/admin/partners/:id/fees",
    pathParams: ["id"],
    queryParams: ["limit", "offset", "status"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        limit: { type: "integer", description: "Max results (default 50)." },
        offset: { type: "integer", description: "Pagination offset." },
        status: STR("Optional fee status filter."),
      },
      ["id"]
    ),
  },
  {
    name: "get_partner_subscription",
    description: "Get a partner's subscriptions (with plan and payments) plus the list of active plans.",
    method: "GET",
    path: "/admin/partners/:id/subscription",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
  },

  // ---- Partner ops writes -------------------------------------------------
  {
    name: "create_partner_task",
    description:
      "Create a new task and assign it to a partner. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/tasks",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: [
      "title",
      "description",
      "status",
      "priority",
      "start_date",
      "end_date",
      "estimated_cost",
      "cost_currency",
      "cost_type",
      "metadata",
    ],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        title: STR("Task title (required)."),
        description: STR("Task description."),
        status: STR("Task status."),
        priority: STR("Task priority: 'low' | 'medium' | 'high'."),
        start_date: STR("Start date (ISO string)."),
        end_date: STR("Due date (ISO string)."),
        estimated_cost: { type: "number", description: "Estimated cost, set at creation." },
        cost_currency: STR("Currency code for estimated/actual cost."),
        cost_type: STR("'per_unit' | 'total'."),
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["id", "title"]
    ),
    sideEffects: "Creates and assigns a new task to the partner.",
    nextSteps: ["get_partner_task", "update_partner_task"],
  },
  {
    name: "update_partner_task",
    description:
      "Update a task assigned to a partner (title/description/status/priority/dates/cost fields). Sensitive: requires confirm:true. Use dry_run to see the current task first.",
    method: "PATCH",
    path: "/admin/partners/:id/tasks/:taskId",
    pathParams: ["id", "taskId"],
    previewPath: "/admin/partners/:id/tasks/:taskId",
    write: true,
    sensitive: true,
    bodyParams: [
      "title",
      "description",
      "status",
      "priority",
      "start_date",
      "end_date",
      "estimated_cost",
      "actual_cost",
      "cost_currency",
      "cost_type",
      "metadata",
    ],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        taskId: STR("Task id, e.g. 'task_...'."),
        title: STR("New title."),
        description: STR("New description."),
        status: STR("New status."),
        priority: STR("New priority: 'low' | 'medium' | 'high'."),
        start_date: STR("New start date (ISO string)."),
        end_date: STR("New due date (ISO string)."),
        estimated_cost: { type: "number", description: "New estimated cost." },
        actual_cost: { type: "number", description: "New actual cost (recorded at finish)." },
        cost_currency: STR("Currency code for cost fields."),
        cost_type: STR("'per_unit' | 'total'."),
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id", "taskId"]
    ),
  },
  {
    name: "create_partner_feedback",
    description:
      "Create a feedback entry linked to a partner. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/feedbacks",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: [
      "rating",
      "comment",
      "status",
      "submitted_by",
      "submitted_at",
      "reviewed_by",
      "reviewed_at",
      "metadata",
    ],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        rating: STR("'one' | 'two' | 'three' | 'four' | 'five' (required)."),
        comment: STR("Feedback comment."),
        status: STR("'pending' | 'reviewed' | 'resolved' (required)."),
        submitted_by: STR("Who submitted the feedback (required)."),
        submitted_at: STR("Submission timestamp (ISO string, required)."),
        reviewed_by: STR("Who reviewed the feedback."),
        reviewed_at: STR("Review timestamp (ISO string)."),
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["id", "rating", "status", "submitted_by", "submitted_at"]
    ),
    sideEffects: "Creates a feedback record linked to the partner.",
  },
  {
    name: "link_partner_people",
    description:
      "Link existing persons (contacts) to a partner by id. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/people",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["person_ids"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        person_ids: {
          type: "array",
          items: { type: "string" },
          description: "Person ids to link to the partner (required, non-empty).",
        },
      },
      ["id", "person_ids"]
    ),
    sideEffects: "Links the given persons to the partner as contacts.",
  },
  {
    name: "create_partner_subscription",
    description:
      "Assign a subscription plan to a partner (admin can comp/trial via skip_payment). Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/subscription",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["plan_id", "payment_provider", "skip_payment", "notes"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        plan_id: STR("Plan id to assign (required)."),
        payment_provider: STR("Payment provider, e.g. 'manual' (defaults to 'manual')."),
        skip_payment: {
          type: "boolean",
          description: "If true and the plan has a cost, record a manual comp/trial payment instead of requiring real payment.",
        },
        notes: STR("Optional admin notes, recorded on the payment/metadata."),
      },
      ["id", "plan_id"]
    ),
    sideEffects: "Creates an active subscription for the partner, optionally recording a manual payment.",
  },

  // ===== Partner ops (#843 tier 3): CRUD parity + admins/comms/artisan ===
  // Round 2 of partner coverage: the core partner record (create/update/
  // delete), task-assign, person-types, unlinking contacts, partner-admin
  // user management, WhatsApp connect/disconnect, the email-verification
  // bypass, and the artisan product approve/reject/proposal trio. Same
  // wrap-an-existing-route pattern as the #1164 tier.
  {
    name: "create_partner",
    description:
      "Create a new partner (seller/manufacturer/individual/designer) with its primary admin user. Sensitive: requires confirm:true. Registers real auth credentials for the admin and emails them a temp password.",
    method: "POST",
    path: "/admin/partners",
    write: true,
    sensitive: true,
    bodyParams: ["partner", "admin"],
    inputSchema: obj(
      {
        partner: {
          type: "object",
          description: "Partner data: { name (required), handle, logo, status, is_verified, workspace_type }.",
          properties: {
            name: STR("Partner name (required)."),
            handle: STR("Unique handle (auto-derived if omitted)."),
            logo: STR("Logo URL."),
            status: STR("'active' | 'inactive' | 'pending' (defaults to 'pending')."),
            is_verified: { type: "boolean", description: "Verification flag (defaults to false)." },
            workspace_type: STR("'seller' | 'manufacturer' | 'individual' | 'designer' (defaults to 'manufacturer')."),
          },
          required: ["name"],
        },
        admin: {
          type: "object",
          description: "Primary admin data: { email, first_name, last_name (required), phone, role }.",
          properties: {
            email: STR("Admin email (required)."),
            first_name: STR("Admin first name (required)."),
            last_name: STR("Admin last name (required)."),
            phone: STR("Admin phone number."),
            role: STR("'owner' | 'admin' | 'manager' (defaults to 'owner')."),
          },
          required: ["email", "first_name", "last_name"],
        },
      },
      ["partner", "admin"]
    ),
    sideEffects: "Creates the partner record, registers an auth identity for the admin, and emails a temp password.",
    nextSteps: ["get_partner", "add_partner_admin"],
  },
  {
    name: "update_partner",
    description:
      "Update a partner's profile (name, handle, logo, status, verification, workspace type, metadata). Sensitive: requires confirm:true. Use dry_run to see the current partner first.",
    method: "PUT",
    path: "/admin/partners/:id",
    pathParams: ["id"],
    previewPath: "/admin/partners/:id",
    write: true,
    sensitive: true,
    bodyParams: ["name", "handle", "logo", "status", "is_verified", "workspace_type", "metadata"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        name: STR("New name."),
        handle: STR("New handle."),
        logo: STR("New logo URL."),
        status: STR("New status: 'active' | 'inactive' | 'pending'."),
        is_verified: { type: "boolean", description: "New verification flag." },
        workspace_type: STR("New workspace type: 'seller' | 'manufacturer' | 'individual' | 'designer'."),
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id"]
    ),
  },
  {
    name: "delete_partner",
    description:
      "Permanently delete a partner. PLATFORM-DESTRUCTIVE: requires confirm:true AND a human reason, and is only available when ADMIN_MCP_ENABLE_DANGEROUS is enabled. Always dry_run first.",
    method: "DELETE",
    path: "/admin/partners/:id",
    pathParams: ["id"],
    previewPath: "/admin/partners/:id",
    write: true,
    dangerous: true,
    inputSchema: obj({ id: STR("Partner id to delete, e.g. 'partner_...'.") }, ["id"]),
    sideEffects: "Irreversibly removes the partner and its admin/auth records.",
  },
  {
    name: "assign_partner_task",
    description:
      "Assign an existing task to a partner (notifies the partner and starts the assignment workflow). Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/tasks/:taskId/assign",
    pathParams: ["id", "taskId"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        taskId: STR("Task id, e.g. 'task_...'."),
      },
      ["id", "taskId"]
    ),
    sideEffects: "Links the task to the partner and notifies them; starts the assignment/acceptance workflow.",
  },
  {
    name: "list_partner_person_types",
    description: "List the person types (roles/categories) linked to a partner.",
    method: "GET",
    path: "/admin/partners/:id/person-types",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
  },
  {
    name: "set_partner_person_types",
    description:
      "Set (replace) the person types linked to a partner. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/person-types",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["person_type_ids"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        person_type_ids: {
          type: "array",
          items: { type: "string" },
          description: "Person type ids to set on the partner (required; replaces the existing set).",
        },
      },
      ["id", "person_type_ids"]
    ),
    sideEffects: "Replaces the partner's full set of linked person types.",
  },
  {
    name: "unlink_partner_people",
    description:
      "Unlink persons (contacts) from a partner. Sensitive: requires confirm:true.",
    method: "DELETE",
    path: "/admin/partners/:id/people",
    pathParams: ["id"],
    write: true,
    bodyParams: ["person_ids"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        person_ids: {
          type: "array",
          items: { type: "string" },
          description: "Person ids to unlink from the partner (required, non-empty).",
        },
      },
      ["id", "person_ids"]
    ),
    sideEffects: "Removes the contact link between the given persons and the partner.",
  },
  {
    name: "list_partner_admins",
    description: "List the admin users (owner/admin/manager) belonging to a partner.",
    method: "GET",
    path: "/admin/partners/:id/admins",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
  },
  {
    name: "add_partner_admin",
    description:
      "Add a new admin user to an existing partner. Registers auth credentials and emails them a temp password. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/admins",
    pathParams: ["id"],
    previewPath: "/admin/partners/:id/admins",
    write: true,
    sensitive: true,
    bodyParams: ["email", "first_name", "last_name", "phone", "role"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        email: STR("Admin email (required)."),
        first_name: STR("Admin first name."),
        last_name: STR("Admin last name."),
        phone: STR("Admin phone number."),
        role: STR("'owner' | 'admin' | 'manager' (defaults to 'admin')."),
      },
      ["id", "email"]
    ),
    sideEffects: "Creates an auth identity for the new admin and emails a temp password.",
    nextSteps: ["list_partner_admins", "update_partner_admin"],
  },
  {
    name: "update_partner_admin",
    description:
      "Update a partner admin's profile (name, phone, role, preferred language, active flag). Sensitive: requires confirm:true. Use dry_run to see the partner's admins first.",
    method: "PATCH",
    path: "/admin/partners/:id/admins/:adminId",
    pathParams: ["id", "adminId"],
    previewPath: "/admin/partners/:id/admins",
    write: true,
    sensitive: true,
    bodyParams: ["first_name", "last_name", "phone", "role", "preferred_language", "is_active"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        adminId: STR("Partner admin id to update."),
        first_name: STR("New first name."),
        last_name: STR("New last name."),
        phone: STR("New phone number."),
        role: STR("New role: 'owner' | 'admin' | 'manager'."),
        preferred_language: STR("New preferred language code."),
        is_active: { type: "boolean", description: "Whether the admin account is active." },
      },
      ["id", "adminId"]
    ),
  },
  {
    name: "connect_partner_whatsapp",
    description:
      "Set a partner's WhatsApp number and send the welcome template to start onboarding. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/whatsapp-verify",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["phone"],
    inputSchema: obj(
      {
        id: STR("Partner id, e.g. 'partner_...'."),
        phone: STR("WhatsApp number with country code, e.g. '919876543210' (required)."),
      },
      ["id", "phone"]
    ),
    sideEffects: "Sends a WhatsApp welcome template to the partner and records the conversation.",
  },
  {
    name: "disconnect_partner_whatsapp",
    description: "Disconnect WhatsApp from a partner. Sensitive: requires confirm:true.",
    method: "DELETE",
    path: "/admin/partners/:id/whatsapp-verify",
    pathParams: ["id"],
    write: true,
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
    sideEffects: "Clears the partner's WhatsApp number and verification flag.",
  },
  {
    name: "bypass_partner_email_verification",
    description:
      "Mark a partner admin's email as verified, bypassing the login gate. Idempotent. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/partners/:id/bypass-email-verification",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Partner id, e.g. 'partner_...'.") }, ["id"]),
    sideEffects: "Marks the partner admin's email verified so they can log in without clicking the email link.",
  },
  {
    name: "get_partner_product_proposal",
    description:
      "Read the artisan-proposal state of a product: whether it's artisan-owned, its status, owning partner, and whether it can currently be approved/rejected.",
    method: "GET",
    path: "/admin/partners/products/:id/proposal",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Product id, e.g. 'prod_...'.") }, ["id"]),
  },
  {
    name: "approve_partner_product",
    description:
      "Approve an artisan's proposed product: publishes it and attaches the core sales channel. Sensitive: requires confirm:true. Use get_partner_product_proposal first to check can_approve.",
    method: "POST",
    path: "/admin/partners/products/:id/approve",
    pathParams: ["id"],
    previewPath: "/admin/partners/products/:id/proposal",
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Product id, e.g. 'prod_...'.") }, ["id"]),
    sideEffects: "Publishes the product and emits partner_product.approved (cross-list subscriber attaches the core sales channel).",
  },
  {
    name: "reject_partner_product",
    description:
      "Reject an artisan's proposed product, optionally with a reason shown to the artisan. Sensitive: requires confirm:true. Use get_partner_product_proposal first to check can_reject.",
    method: "POST",
    path: "/admin/partners/products/:id/reject",
    pathParams: ["id"],
    previewPath: "/admin/partners/products/:id/proposal",
    write: true,
    sensitive: true,
    bodyParams: ["rejection_reason"],
    inputSchema: obj(
      {
        id: STR("Product id, e.g. 'prod_...'."),
        rejection_reason: STR("Optional reason shown to the artisan in the rejection email."),
      },
      ["id"]
    ),
    sideEffects: "Sets the product to 'rejected' and emits partner_product.rejected.",
  },

  // ===== Orders ops (#1165): fulfillment, shipping and order edits =======
  // Wraps the order detail page's actions. Fulfilling and shipping are
  // `sensitive` (they notify the customer and hit a live carrier API);
  // cancelling an order or a fulfillment, and confirming an order edit, are
  // `dangerous` — irreversible once the workflow runs.
  {
    name: "list_order_changes",
    description:
      "List the change history of an order (order edits, returns, exchanges, claims) with their status and type. Use to explain why an order's totals or line items differ from the original.",
    method: "GET",
    path: "/admin/orders/:id/changes",
    pathParams: ["id"],
    queryParams: ["status", "change_type"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        status: STR("Optional change status filter."),
        change_type: STR("Optional change type filter, e.g. 'edit' | 'return' | 'exchange'."),
      },
      ["id"]
    ),
  },
  {
    name: "list_order_designs",
    description:
      "List the designs attached to an order's line items. Use before produce_order_designs to see what would be sent to production.",
    method: "GET",
    path: "/admin/orders/:id/design",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Order id, e.g. 'order_...'.") }, ["id"]),
  },
  {
    name: "list_order_shipping_rates",
    description:
      "List the available courier options for an order (rate, ETA, recommended flag). Call this before create_order_shipping_label to pick a preferred_courier_id.",
    method: "GET",
    path: "/admin/orders/:id/fulfillment-rates",
    pathParams: ["id"],
    queryParams: ["carrier", "weight_grams"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        carrier: STR("Optional carrier to scope the quote to."),
        weight_grams: { type: "number", description: "Override shipment weight in grams." },
      },
      ["id"]
    ),
    nextSteps: ["create_order_shipping_label"],
  },
  {
    name: "get_order_fulfillment_label",
    description:
      "Get the shipping label for an existing fulfillment (label URL / waybill). Returns 404 if the fulfillment has no waybill yet.",
    method: "GET",
    path: "/admin/orders/:id/fulfillments/:fulfillmentId/label",
    pathParams: ["id", "fulfillmentId"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        fulfillmentId: STR("Fulfillment id, e.g. 'ful_...'."),
      },
      ["id", "fulfillmentId"]
    ),
  },

  // ---- Order writes -------------------------------------------------------
  {
    name: "update_order",
    description:
      "Update an order's email or shipping/billing address. Sensitive: requires confirm:true. Use dry_run to see the current order first. Does NOT change line items — use the order-edit tools for that.",
    method: "POST",
    path: "/admin/orders/:id",
    pathParams: ["id"],
    previewPath: "/admin/orders/:id",
    write: true,
    sensitive: true,
    bodyParams: ["email", "shipping_address", "billing_address", "metadata"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        email: STR("New order email."),
        shipping_address: {
          type: "object",
          description:
            "Replacement shipping address: { first_name, last_name, phone, company, address_1, address_2, city, province, postal_code, country_code }.",
        },
        billing_address: {
          type: "object",
          description: "Replacement billing address (same shape as shipping_address).",
        },
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id"]
    ),
  },
  {
    name: "create_order_fulfillment",
    description:
      "Fulfil items on an order — creates a fulfillment for the given line items at a stock location. Sensitive: requires confirm:true. Call get_order first to read the line item ids and quantities.",
    method: "POST",
    path: "/admin/orders/:id/fulfillments",
    pathParams: ["id"],
    previewPath: "/admin/orders/:id",
    write: true,
    sensitive: true,
    bodyParams: ["items", "location_id", "shipping_option_id", "no_notification", "metadata"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        items: {
          type: "array",
          description:
            "Line items to fulfil (required, non-empty). Each: { id: order line item id, quantity: number }.",
          items: obj(
            {
              id: STR("Order line item id."),
              quantity: { type: "number", description: "Quantity to fulfil." },
            },
            ["id", "quantity"]
          ),
        },
        location_id: STR("Stock location to fulfil from."),
        shipping_option_id: STR("Shipping option to use."),
        no_notification: { type: "boolean", description: "Suppress the customer notification." },
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["id", "items"]
    ),
    sideEffects: "Reserves/deducts inventory at the location and notifies the customer unless no_notification is set.",
    nextSteps: ["create_order_shipment", "create_order_shipping_label"],
  },
  {
    name: "create_order_shipment",
    description:
      "Mark a fulfillment as SHIPPED, optionally attaching tracking numbers/URLs. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/orders/:id/fulfillments/:fulfillmentId/shipments",
    pathParams: ["id", "fulfillmentId"],
    previewPath: "/admin/orders/:id",
    write: true,
    sensitive: true,
    bodyParams: ["items", "labels", "no_notification", "metadata"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        fulfillmentId: STR("Fulfillment id, e.g. 'ful_...'."),
        items: {
          type: "array",
          description: "Items being shipped (required; may be empty). Each: { id, quantity }.",
          items: obj(
            {
              id: STR("Order line item id."),
              quantity: { type: "number", description: "Quantity shipped." },
            },
            ["id", "quantity"]
          ),
        },
        labels: {
          type: "array",
          description:
            "Tracking labels. Each requires { tracking_number, tracking_url, label_url } — URLs must be http(s).",
          items: obj(
            {
              tracking_number: STR("Carrier tracking number."),
              tracking_url: STR("Tracking URL (http/https)."),
              label_url: STR("Label PDF URL (http/https)."),
            },
            ["tracking_number", "tracking_url", "label_url"]
          ),
        },
        no_notification: { type: "boolean", description: "Suppress the shipment email." },
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["id", "fulfillmentId", "items"]
    ),
    sideEffects: "Marks the fulfillment shipped and emails the customer unless no_notification is set.",
    nextSteps: ["mark_order_fulfillment_delivered"],
  },
  {
    name: "mark_order_fulfillment_delivered",
    description:
      "Mark a fulfillment as DELIVERED. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/orders/:id/fulfillments/:fulfillmentId/mark-as-delivered",
    pathParams: ["id", "fulfillmentId"],
    previewPath: "/admin/orders/:id",
    write: true,
    sensitive: true,
    bodyParams: ["no_notification"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        fulfillmentId: STR("Fulfillment id, e.g. 'ful_...'."),
        no_notification: { type: "boolean", description: "Suppress the customer notification." },
      },
      ["id", "fulfillmentId"]
    ),
  },
  {
    name: "cancel_order_fulfillment",
    description:
      "Cancel a fulfillment and return its items to stock. PLATFORM-DESTRUCTIVE: requires confirm:true AND a human reason, and is only available when ADMIN_MCP_ENABLE_DANGEROUS is enabled. Cannot be undone — a cancelled fulfillment must be re-created. Always dry_run first.",
    method: "POST",
    path: "/admin/orders/:id/fulfillments/:fulfillmentId/cancel",
    pathParams: ["id", "fulfillmentId"],
    previewPath: "/admin/orders/:id",
    write: true,
    dangerous: true,
    bodyParams: ["no_notification"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        fulfillmentId: STR("Fulfillment id, e.g. 'ful_...'."),
        no_notification: { type: "boolean", description: "Suppress the customer notification." },
      },
      ["id", "fulfillmentId"]
    ),
    sideEffects: "Reverses the fulfillment and restocks its items. Already-shipped fulfillments cannot be cancelled.",
  },
  {
    name: "cancel_order",
    description:
      "Cancel an entire order. PLATFORM-DESTRUCTIVE: requires confirm:true AND a human reason, and is only available when ADMIN_MCP_ENABLE_DANGEROUS is enabled. Irreversible — the order cannot be un-cancelled. Always dry_run first.",
    method: "POST",
    path: "/admin/orders/:id/cancel",
    pathParams: ["id"],
    previewPath: "/admin/orders/:id",
    write: true,
    dangerous: true,
    inputSchema: obj({ id: STR("Order id to cancel, e.g. 'order_...'.") }, ["id"]),
    sideEffects: "Cancels payments and fulfillments on the order and notifies the customer. Fails if the order is already fulfilled or captured.",
  },
  {
    name: "complete_order",
    description:
      "Mark an order as complete (closes it for further edits). Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/orders/:id/complete",
    pathParams: ["id"],
    previewPath: "/admin/orders/:id",
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Order id, e.g. 'order_...'.") }, ["id"]),
    sideEffects: "Sets the order to 'completed'; further order edits are blocked.",
  },
  {
    name: "produce_order_designs",
    description:
      "Send an order's design line items to production: creates one production run per design, collated into a single design work-order. Idempotent — re-running does not duplicate runs. Sensitive: requires confirm:true. Call list_order_designs first.",
    method: "POST",
    path: "/admin/orders/:id/design/produce",
    pathParams: ["id"],
    previewPath: "/admin/orders/:id/design",
    write: true,
    sensitive: true,
    bodyParams: ["partner_id"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        partner_id: STR("Optional partner to assign every created run to."),
      },
      ["id"]
    ),
    sideEffects: "Creates production runs and a collated design work-order for the order.",
    nextSteps: ["list_production_runs", "approve_production_run"],
  },
  {
    name: "create_order_shipping_label",
    description:
      "One-click ship: create (or reuse) a fulfillment for the whole order, book the carrier shipment and buy the label. Sensitive: requires confirm:true. Call list_order_shipping_rates first to choose preferred_courier_id.",
    method: "POST",
    path: "/admin/orders/:id/fulfillment-label",
    pathParams: ["id"],
    previewPath: "/admin/orders/:id",
    write: true,
    sensitive: true,
    bodyParams: ["carrier", "preferred_courier_id"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        carrier: STR("Carrier to book with (defaults to the configured provider)."),
        preferred_courier_id: STR("Courier id from list_order_shipping_rates."),
      },
      ["id"]
    ),
    sideEffects: "Calls the live carrier API, books a real shipment and buys a label — this costs money and is not undone by cancelling the fulfillment.",
  },
  {
    name: "attach_order_awb",
    description:
      "Attach an EXISTING carrier waybill (AWB) to an order — reuses or creates a manual fulfillment, looks the AWB up read-only, and stamps the carrier refs. Use when a shipment was booked outside the platform. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/orders/:id/shiprocket-attach-awb",
    pathParams: ["id"],
    previewPath: "/admin/orders/:id",
    write: true,
    sensitive: true,
    bodyParams: ["awb"],
    inputSchema: obj(
      {
        id: STR("Order id, e.g. 'order_...'."),
        awb: STR("The existing carrier waybill number (required)."),
      },
      ["id", "awb"]
    ),
    sideEffects: "Does NOT book a new shipment — it only links an already-booked AWB and syncs its status.",
  },

  // ---- Order edits (line-item changes on a placed order) ------------------
  // A staged workflow: create an edit -> add/update items -> request ->
  // confirm. Nothing touches the real order until confirm_order_edit runs,
  // which is why only that last step is `dangerous`.
  {
    name: "create_order_edit",
    description:
      "Start an order edit — a staged draft for changing a placed order's line items. Nothing changes on the order until confirm_order_edit. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/order-edits",
    write: true,
    sensitive: true,
    bodyParams: ["order_id", "description", "internal_note", "metadata"],
    inputSchema: obj(
      {
        order_id: STR("Order id to edit, e.g. 'order_...' (required)."),
        description: STR("Customer-facing description of the edit."),
        internal_note: STR("Internal note for the ops team."),
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["order_id"]
    ),
    sideEffects: "Creates a draft order-change. The order itself is untouched until the edit is confirmed.",
    nextSteps: ["add_order_edit_items", "update_order_edit_item", "request_order_edit"],
  },
  {
    name: "add_order_edit_items",
    description:
      "Add new line items to an in-progress order edit. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/order-edits/:id/items",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["items"],
    inputSchema: obj(
      {
        id: STR("Order edit (order-change) id."),
        items: {
          type: "array",
          description: "Items to add. Each: { variant_id, quantity, unit_price?, internal_note? }.",
          items: obj(
            {
              variant_id: STR("Product variant id to add."),
              quantity: { type: "number", description: "Quantity to add." },
              unit_price: { type: "number", description: "Override unit price." },
              internal_note: STR("Internal note on the added item."),
            },
            ["variant_id", "quantity"]
          ),
        },
      },
      ["id", "items"]
    ),
  },
  {
    name: "update_order_edit_item",
    description:
      "Change the quantity or price of an EXISTING line item within an in-progress order edit (this is how you remove an item — set quantity to 0). Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/order-edits/:id/items/item/:itemId",
    pathParams: ["id", "itemId"],
    write: true,
    sensitive: true,
    bodyParams: ["quantity", "unit_price", "internal_note"],
    inputSchema: obj(
      {
        id: STR("Order edit (order-change) id."),
        itemId: STR("The ORIGINAL order line item id being changed."),
        quantity: { type: "number", description: "New quantity (required). 0 removes the item." },
        unit_price: { type: "number", description: "New unit price." },
        internal_note: STR("Internal note on the change."),
      },
      ["id", "itemId", "quantity"]
    ),
  },
  {
    name: "request_order_edit",
    description:
      "Move an order edit from draft to 'requested' (awaiting confirmation). Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/order-edits/:id/request",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Order edit (order-change) id.") }, ["id"]),
    nextSteps: ["confirm_order_edit", "cancel_order_edit"],
  },
  {
    name: "confirm_order_edit",
    description:
      "APPLY an order edit to the real order — recalculates totals and may create a payment or refund. PLATFORM-DESTRUCTIVE: requires confirm:true AND a human reason, and is only available when ADMIN_MCP_ENABLE_DANGEROUS is enabled. Always dry_run first.",
    method: "POST",
    path: "/admin/order-edits/:id/confirm",
    pathParams: ["id"],
    write: true,
    dangerous: true,
    inputSchema: obj({ id: STR("Order edit (order-change) id to apply.") }, ["id"]),
    sideEffects: "Mutates the placed order's line items and totals, and can trigger an additional charge or a refund. Not reversible by cancelling the edit.",
  },
  {
    name: "cancel_order_edit",
    description:
      "Discard an in-progress order edit without applying it. Safe to call on any unconfirmed edit. Sensitive: requires confirm:true.",
    method: "DELETE",
    path: "/admin/order-edits/:id",
    pathParams: ["id"],
    write: true,
    inputSchema: obj({ id: STR("Order edit (order-change) id to discard.") }, ["id"]),
    sideEffects: "Throws away the draft edit. The underlying order is unaffected.",
  },

  // ===== Production runs (#1167): the admin lifecycle levers =============
  // create -> approve (this is where partners are assigned) -> either
  // send-to-production (instantiate task templates) OR start/resume-dispatch
  // -> cancel. Accept/start/finish are PARTNER-side routes and deliberately
  // absent here. Statuses: draft | pending_review | approved | sent_to_partner
  // | in_progress | completed | cancelled | awaiting_reassignment.
  {
    name: "get_production_run",
    description:
      "Get a single production run by id, with its linked tasks. Use to read the run's status, quantity, assigned partner, dispatch state and cost fields.",
    method: "GET",
    path: "/admin/production-runs/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Production run id.") }, ["id"]),
  },
  {
    name: "list_production_run_activities",
    description:
      "Read a production run's activity timeline (reminders sent, lifecycle events, notes), newest first. Use to answer 'what happened on this run'.",
    method: "GET",
    path: "/admin/production-runs/:id/activities",
    pathParams: ["id"],
    queryParams: ["limit", "offset", "activity_type", "kind"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        limit: { type: "integer", description: "Max rows (default 100, max 500)." },
        offset: { type: "integer", description: "Pagination offset." },
        activity_type: STR("'reminder_sent' | 'lifecycle_event' | 'note' | 'system'."),
        kind: STR("Optional free-text activity kind filter."),
      },
      ["id"]
    ),
  },
  {
    name: "get_production_run_cost_summary",
    description:
      "Get a production run's computed cost rollup: material, energy, labour and partner cost, grand total and cost per unit.",
    method: "GET",
    path: "/admin/production-runs/:id/cost-summary",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Production run id.") }, ["id"]),
  },
  {
    name: "get_production_run_task",
    description: "Get a single task belonging to a production run.",
    method: "GET",
    path: "/admin/production-runs/:id/tasks/:taskId",
    pathParams: ["id", "taskId"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        taskId: STR("Task id, e.g. 'task_...'."),
      },
      ["id", "taskId"]
    ),
  },
  {
    name: "get_production_run_policy",
    description:
      "Read the platform's production-run policy: which run statuses each lifecycle transition (approve, dispatch, send-to-production, accept, start, finish, decline) is allowed from.",
    method: "GET",
    path: "/admin/production-run-policy",
    inputSchema: obj({}),
  },

  // ---- Production run writes ---------------------------------------------
  {
    name: "create_production_run",
    description:
      "Create a production run for a design. Sensitive: requires confirm:true. The run starts in 'pending_review' — partners are assigned later via approve_production_run, not here.",
    method: "POST",
    path: "/admin/production-runs",
    write: true,
    sensitive: true,
    bodyParams: [
      "design_id",
      "partner_id",
      "quantity",
      "run_type",
      "product_id",
      "variant_id",
      "order_id",
      "order_line_item_id",
      "metadata",
    ],
    inputSchema: obj(
      {
        design_id: STR("Design id to produce (required)."),
        partner_id: STR("Optional partner to pre-assign."),
        quantity: { type: "number", description: "Units to produce (defaults to 1)." },
        run_type: STR("'production' (default) | 'sample'."),
        product_id: STR("Optional linked product id."),
        variant_id: STR("Optional linked variant id."),
        order_id: STR("Optional originating order id."),
        order_line_item_id: STR("Optional originating order line item id."),
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["design_id"]
    ),
    sideEffects: "Creates a run in 'pending_review'. It does no work until it is approved.",
    nextSteps: ["approve_production_run", "get_production_run"],
  },
  {
    name: "update_production_run",
    description:
      "Update a production run's quantity, role, run type, partner cost estimate, or correct the output the partner reported (produced_quantity / rejected_quantity). Sensitive: requires confirm:true. Structural edits (quantity/role/run_type) are REJECTED once the run has been accepted or started, and any edit is rejected on a cancelled run — but output corrections are allowed precisely BECAUSE the run is completed. Use dry_run to see the current run first.",
    method: "POST",
    path: "/admin/production-runs/:id",
    pathParams: ["id"],
    previewPath: "/admin/production-runs/:id",
    write: true,
    sensitive: true,
    bodyParams: [
      "quantity",
      "role",
      "run_type",
      "partner_cost_estimate",
      "cost_type",
      "produced_quantity",
      "rejected_quantity",
      "correction_reason",
    ],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        quantity: {
          type: "number",
          description:
            "New ORDERED quantity (pre-acceptance only). This is what was asked for — to correct what was actually MADE, use produced_quantity instead.",
        },
        role: STR("New role for the run (pre-acceptance only)."),
        run_type: STR("'production' | 'sample' (pre-acceptance only)."),
        produced_quantity: {
          type: "number",
          description:
            "Correct the number of good pieces the partner reported making. Partners self-report this at completion and do over-report. Editable after completion. Feeds cost-per-unit, the design cost engine, goods-transfer quantities and the public production story, so pass correction_reason too.",
        },
        rejected_quantity: {
          type: "number",
          description: "Correct the number of rejected pieces the partner reported.",
        },
        correction_reason: STR(
          "Why the reported output is being corrected (e.g. 'physical count was 3'). Recorded on the run's activity timeline alongside the before/after values."
        ),
        partner_cost_estimate: {
          type: "number",
          description:
            "Partner cost estimate. Note: the dispatcher drops null arguments, so this tool can set a cost but not clear one — clear it from the admin UI.",
        },
        cost_type: STR("'total' | 'per_unit'."),
      },
      ["id"]
    ),
  },
  {
    name: "approve_production_run",
    description:
      "Approve a production run and assign partners to it. THIS is where partner assignment happens: each assignment fans out a child run, and children carrying template_names are auto-dispatched. Sensitive: requires confirm:true. Use dry_run to see the current run first.",
    method: "POST",
    path: "/admin/production-runs/:id/approve",
    pathParams: ["id"],
    previewPath: "/admin/production-runs/:id",
    write: true,
    sensitive: true,
    bodyParams: ["assignments"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        assignments: {
          type: "array",
          description:
            "Partner assignments. Each: { partner_id (required), role?, quantity?, order? (dispatch sequence), template_names? (task templates to auto-dispatch; omit or null for none) }.",
          items: obj(
            {
              partner_id: STR("Partner to assign (required)."),
              role: STR("Role this partner plays in the run."),
              quantity: { type: "number", description: "Units for this partner." },
              order: { type: "integer", description: "Dispatch sequence position." },
              template_names: {
                type: "array",
                items: { type: "string" },
                description: "Task templates to instantiate and auto-dispatch for this partner.",
              },
            },
            ["partner_id"]
          ),
        },
      },
      ["id"]
    ),
    sideEffects: "Creates one child run per assignment and auto-dispatches those with template_names (skipped entirely if any child declares depends_on_run_ids).",
    nextSteps: ["send_production_run_to_production", "start_production_run_dispatch"],
  },
  {
    name: "send_production_run_to_production",
    description:
      "Instantiate task templates on an approved production run — this creates the partner's tasks and hands the run over. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/production-runs/:id/send-to-production",
    pathParams: ["id"],
    previewPath: "/admin/production-runs/:id",
    write: true,
    sensitive: true,
    bodyParams: ["template_names", "template_ids"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        template_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Task template IDS to instantiate — PREFERRED, and the only way to pick between two same-named templates. Get them from list_task_templates. Wins over template_names.",
        },
        template_names: {
          type: "array",
          items: { type: "string" },
          description:
            "Task template names to instantiate. ⚠️ A name that matches MORE THAN ONE template (e.g. 'Stitching', which exists in both Pre Production and Production) is REJECTED — the dispatch fails and nothing is created. Use template_ids for those.",
        },
      },
      ["id"]
    ),
    sideEffects: "Creates partner tasks from the templates and notifies the assigned partner.",
  },
  {
    name: "list_task_templates",
    description:
      "List the task templates available to dispatch a production run with, ORGANISED BY CATEGORY — the catalogue of process steps. Categories are the real structure: 'Pre Production' (Sampling, Cutting, Measurement, Stitching, Embroidery and Painting), 'Production' (Research, Pattern Cutting, Stitching, Quality Check, Block Printing), 'Design Orders' and 'Partner Orders' (the partner-* lifecycle templates). Every tool that takes template_names needs names FROM HERE: a name that does not exist fails the dispatch with 'Missing task templates'. Use it to show the user a real choice instead of guessing. ⚠️ A NAME ALONE MAY NOT IDENTIFY A TEMPLATE — 'Stitching' exists in BOTH Pre Production and Production, and they are different steps. Always read `category.name` alongside the name, present the category to the user when a name is duplicated, and narrow with category_name when you know which stage you mean.",
    method: "GET",
    path: "/admin/task-templates",
    // ONLY the filters the handler actually forwards. `limit`, `offset`,
    // `fields` and `expand` are accepted by the route and then DROPPED —
    // listTaskTemplatesStep discards `input.config` — so declaring them would
    // silently ignore the model's paging, the same defect as #1172. The route
    // returns every template.
    queryParams: ["name", "priority", "category_id", "category_name"],
    inputSchema: obj({
      name: STR(
        "Exact template name. Omit to get every template — the list is small and unpaginated."
      ),
      category_name: STR(
        "Only templates in this category, BY NAME: 'Pre Production' | 'Production' | 'Design Orders' | 'Partner Orders' | 'Research'. The way to disambiguate a name that exists in more than one category."
      ),
      priority: STR("Filter by priority: 'low' | 'medium' | 'high'."),
      category_id: STR(
        "Only templates in this category, by id. Prefer category_name unless you already hold an id."
      ),
    }),
    nextSteps: [
      "redispatch_parked_production_runs",
      "send_production_run_to_production",
      "resume_production_run_dispatch",
    ],
  },
  {
    name: "redispatch_parked_production_runs",
    description:
      "Re-send production runs parked in 'awaiting_reassignment' back to the PARTNER THEY CAME FROM, and dispatch them again — the batch answer to 'this partner says they'll take their lapsed runs now'. Each run goes to its own previous_partner_id; partner_id only FILTERS which parked runs are considered, so this can never hand one partner's work to another. THE DRY-RUN RECOVERS WHAT EACH RUN WAS DISPATCHED WITH LAST TIME (from its own tasks) and lists every available template, so you can show the user a real selection instead of asking them to remember: read `would_redispatch[].previous_template_names` and `available_template_names`. Then confirm with use_previous_templates:true to send each run back with ITS OWN set (parked runs usually do NOT share one), or template_names/template_ids to override them all. Recovered history dispatches by template ID where it identified one, so a run that used 'Stitching (Production)' cannot come back as 'Stitching (Pre Production)'; a run that would go out on an AMBIGUOUS name is reported as would_fail_on_ambiguous_name and must be given template_ids. Dry-run by default. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/production-runs/redispatch-parked",
    write: true,
    sensitive: true,
    bodyParams: [
      "partner_id",
      "template_names",
      "template_ids",
      "use_previous_templates",
      "limit",
      "note",
      "dry_run",
      "confirm",
    ],
    inputSchema: obj({
      partner_id: STR(
        "Only consider runs parked FROM this partner. Omit for every parked run."
      ),
      template_names: {
        type: "array",
        items: { type: "string" },
        description:
          "Dispatch EVERY selected run with these templates, overriding recovered history. Use only when the runs really should share one set — otherwise prefer use_previous_templates. ⚠️ An ambiguous name is REJECTED at dispatch; use template_ids for those.",
      },
      template_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "The same override BY ID — unambiguous, and what to use when a name matches two templates. Wins over template_names. Ids come from list_task_templates or the dry-run's available_templates_by_category[].templates[].id.",
      },
      use_previous_templates: {
        type: "boolean",
        description:
          "Dispatch each run with the templates IT used last time, recovered per run from its own tasks. The safe way to re-send a mixed batch end-to-end.",
      },
      limit: { type: "integer", description: "Cap how many runs are re-sent." },
      note: STR("Admin note recorded on each run's activity feed."),
      dry_run: {
        type: "boolean",
        description: "Default true — preview which runs would be re-sent.",
      },
      confirm: { type: "boolean", description: "Required to actually re-send." },
    }),
    sideEffects:
      "Assigns each run to its previous partner and starts dispatch, which notifies the partner. Runs dispatched with no template selection (neither template_names nor a recoverable history under use_previous_templates) stay in 'awaiting_templates' until resume_production_run_dispatch is called with the returned transaction_id.",
    nextSteps: [
      "list_task_templates",
      "resume_production_run_dispatch",
      "list_production_runs",
    ],
  },
  {
    name: "start_production_run_dispatch",
    description:
      "Begin the interactive dispatch of a production run. Returns a transaction_id and PARKS the workflow with the run in 'awaiting_templates' — you MUST follow up with resume_production_run_dispatch or the run stays stuck. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/production-runs/:id/start-dispatch",
    pathParams: ["id"],
    previewPath: "/admin/production-runs/:id",
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Production run id.") }, ["id"]),
    sideEffects: "Leaves the run parked in dispatch_state 'awaiting_templates' until resume_production_run_dispatch is called with the returned transaction_id.",
    nextSteps: ["resume_production_run_dispatch"],
  },
  {
    name: "resume_production_run_dispatch",
    description:
      "Complete a parked dispatch by supplying the chosen task templates. Requires the transaction_id returned by start_production_run_dispatch. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/production-runs/:id/resume-dispatch",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["template_names", "template_ids", "transaction_id"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        template_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Task template IDS to dispatch — PREFERRED. The only unambiguous selection; wins over template_names.",
        },
        template_names: {
          type: "array",
          items: { type: "string" },
          description:
            "Task template names to dispatch. ⚠️ An ambiguous name (one matching several templates, like 'Stitching') is REJECTED rather than guessed at — pass template_ids instead.",
        },
        transaction_id: STR("The transaction_id returned by start_production_run_dispatch (required)."),
      },
      ["id", "transaction_id"]
    ),
  },
  {
    name: "cancel_production_run",
    description:
      "Cancel a production run, its open tasks and all of its child runs. PLATFORM-DESTRUCTIVE: requires confirm:true AND a human reason, and is only available when ADMIN_MCP_ENABLE_DANGEROUS is enabled. Cascades to the parent run when every sibling is terminal. Always dry_run first.",
    method: "POST",
    path: "/admin/production-runs/:id/cancel",
    pathParams: ["id"],
    previewPath: "/admin/production-runs/:id",
    write: true,
    dangerous: true,
    // The dangerous rail's `reason` doubles as the route's cancellation reason:
    // it is injected onto the schema by buildToolInputSchema and picked up here
    // as a body param, so the audited "why" is what gets persisted on the run.
    bodyParams: ["reason"],
    inputSchema: obj({ id: STR("Production run id to cancel.") }, ["id"]),
    sideEffects: "Cancels the run's non-terminal tasks, cascades to child runs, mirrors the state to the unified order and emits production_run.cancelled. Cancelled runs are terminal — they cannot be reopened.",
  },
  {
    name: "update_production_run_task",
    description:
      "Update a task on a production run (title, description, status, priority, dates). Sensitive: requires confirm:true. Use dry_run to see the current task first. NOTE: this route does not validate enums server-side — only send the documented values.",
    method: "POST",
    path: "/admin/production-runs/:id/tasks/:taskId",
    pathParams: ["id", "taskId"],
    previewPath: "/admin/production-runs/:id/tasks/:taskId",
    write: true,
    sensitive: true,
    bodyParams: [
      "title",
      "description",
      "status",
      "priority",
      "start_date",
      "end_date",
      "metadata",
    ],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        taskId: STR("Task id, e.g. 'task_...'."),
        title: STR("New title."),
        description: STR("New description."),
        status: STR(
          "New status — one of exactly: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'accepted' | 'blocked'."
        ),
        priority: STR("New priority — one of exactly: 'low' | 'medium' | 'high'."),
        start_date: STR("New start date (ISO string)."),
        end_date: STR("New due date (ISO string)."),
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id", "taskId"]
    ),
  },
  {
    name: "update_production_run_policy",
    description:
      "Replace the platform-wide production-run policy config (which statuses each lifecycle transition is allowed from). This is a FULL REPLACE, not a merge, and it affects every run on the platform. Sensitive: requires confirm:true. Always call get_production_run_policy and dry_run first.",
    method: "PUT",
    path: "/admin/production-run-policy",
    previewPath: "/admin/production-run-policy",
    write: true,
    sensitive: true,
    bodyParams: ["config"],
    inputSchema: obj(
      {
        config: {
          type: "object",
          description:
            "The COMPLETE replacement policy config, e.g. { transitions: { approve_from: [...], dispatch_from: [...] } }. Read the current one with get_production_run_policy and send it back with your edits applied.",
        },
      },
      ["config"]
    ),
    sideEffects: "Overwrites the singleton policy for ALL production runs; omitted keys are lost, not preserved.",
  },

  // ===== Designs (#1166): the design -> production pipeline ==============
  // The designs domain is large; this wraps the operationally meaningful
  // slice — core CRUD (which is also the ONLY way to set size_sets/colors),
  // the collated work-order read, the produce/recreate/cancel triangle, and
  // task state. AI-generation, segmentation, outline/vectorize, moodboard and
  // pattern-block routes are deliberately NOT wrapped: they are file-upload
  // shaped, cost money per call, or return payloads (SVG documents, Excalidraw
  // scenes) that would blow the chat context.
  {
    name: "list_design_work_orders",
    description:
      "List collated design work-orders — each with its per-design production runs, the designs themselves and the assigned partners. This is the single best read for 'what is in production right now'.",
    method: "GET",
    path: "/admin/design-work-orders",
    queryParams: ["limit", "offset"],
    inputSchema: obj({
      limit: { type: "integer", description: "Max results (default 20)." },
      offset: { type: "integer", description: "Pagination offset." },
    }),
  },
  {
    name: "list_design_revisions",
    description:
      "Get a design's full revision lineage (ancestors, current, descendants). Use to explain why a design is 'Superseded' or to find the live revision.",
    method: "GET",
    path: "/admin/designs/:id/revisions",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Design id, e.g. 'design_...'.") }, ["id"]),
  },
  {
    name: "list_design_inventory",
    description:
      "List the inventory items linked to a design (its bill of materials) with planned quantities.",
    method: "GET",
    path: "/admin/designs/:id/inventory",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Design id, e.g. 'design_...'.") }, ["id"]),
  },
  {
    name: "list_design_tasks",
    description: "List the tasks attached to a design.",
    method: "GET",
    path: "/admin/designs/:id/tasks",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Design id, e.g. 'design_...'.") }, ["id"]),
  },
  {
    name: "get_design_task",
    description: "Get a single task on a design by task id.",
    method: "GET",
    path: "/admin/designs/:id/tasks/:taskId",
    pathParams: ["id", "taskId"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        taskId: STR("Task id, e.g. 'task_...'."),
      },
      ["id", "taskId"]
    ),
  },

  // ---- Design writes ------------------------------------------------------
  {
    name: "create_design",
    description:
      "Create a new design. Sensitive: requires confirm:true. A name is enough; everything else can be filled in later with update_design.",
    method: "POST",
    path: "/admin/designs",
    write: true,
    sensitive: true,
    bodyParams: [
      "name",
      "description",
      "design_type",
      "status",
      "priority",
      "target_completion_date",
      "tags",
      "designer_notes",
      "estimated_cost",
      "cost_currency",
      "colors",
      "size_sets",
      "inspiration_sources",
      "thumbnail_url",
      "metadata",
    ],
    inputSchema: obj(
      {
        name: STR("Design name (required)."),
        // Was required here as a workaround: omitting it used to 500 on the
        // model's NOT NULL column. #1172 defaults it at the route, so a
        // name-only draft is legal again — still worth sending when known.
        description: STR("Design description. Optional; defaults to empty."),
        design_type: STR("'Original' | 'Derivative' | 'Custom' | 'Collaboration'."),
        status: STR(
          "'Conceptual' | 'In_Development' | 'Technical_Review' | 'Sample_Production' | 'Revision' | 'Approved' | 'Rejected' | 'On_Hold' | 'Commerce_Ready' | 'Superseded'."
        ),
        priority: STR("'Low' | 'Medium' | 'High' | 'Urgent'."),
        target_completion_date: STR("Target completion date (ISO string)."),
        tags: { type: "array", items: { type: "string" }, description: "Free-form tags." },
        designer_notes: STR("Notes for the designer."),
        inspiration_sources: {
          type: "array",
          items: { type: "string" },
          description:
            "Reference urls the design came from — a Pinterest pin, a lookbook, a supplier page. Record the link the operator gave you here rather than dropping it.",
        },
        thumbnail_url: STR(
          "Url of the reference/hero image for this design (e.g. an attached photo or a pin's image url)."
        ),
        estimated_cost: { type: "number", description: "Estimated cost." },
        cost_currency: STR("Currency code for estimated_cost."),
        colors: {
          type: "array",
          description: "Colourway. Each: { name, hex_code, usage_notes?, order? }.",
          items: obj(
            { name: STR("Colour name."), hex_code: STR("Hex code, e.g. '#1A2B3C'.") },
            ["name", "hex_code"]
          ),
        },
        size_sets: {
          type: "array",
          description:
            "Size sets — the source of truth for sizing. Each: { size_label, measurements: { <point>: number } }.",
          items: obj(
            {
              size_label: STR("Size label, e.g. 'M'."),
              measurements: {
                type: "object",
                description: "Measurement point -> numeric value.",
              },
            },
            ["size_label", "measurements"]
          ),
        },
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["name"]
    ),
    nextSteps: ["get_design", "update_design", "link_design_partners"],
  },
  {
    name: "update_design",
    description:
      "Update a design — status, priority, target date, tags, notes, colours and SIZE SETS (this route is the only way to set size_sets). Sensitive: requires confirm:true. Use dry_run to see the current design first.",
    method: "PUT",
    path: "/admin/designs/:id",
    pathParams: ["id"],
    previewPath: "/admin/designs/:id",
    write: true,
    sensitive: true,
    bodyParams: [
      "name",
      "description",
      "design_type",
      "status",
      "priority",
      "target_completion_date",
      "tags",
      "designer_notes",
      "estimated_cost",
      "cost_currency",
      "colors",
      "size_sets",
      "inspiration_sources",
      "thumbnail_url",
      "metadata",
    ],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        name: STR("New name."),
        description: STR("New description."),
        design_type: STR("'Original' | 'Derivative' | 'Custom' | 'Collaboration'."),
        status: STR(
          "'Conceptual' | 'In_Development' | 'Technical_Review' | 'Sample_Production' | 'Revision' | 'Approved' | 'Rejected' | 'On_Hold' | 'Commerce_Ready' | 'Superseded'."
        ),
        priority: STR("'Low' | 'Medium' | 'High' | 'Urgent'."),
        target_completion_date: STR("New target completion date (ISO string)."),
        tags: { type: "array", items: { type: "string" }, description: "Replacement tag list." },
        designer_notes: STR("New designer notes."),
        inspiration_sources: {
          type: "array",
          items: { type: "string" },
          description:
            "Reference urls the design came from — a Pinterest pin, a lookbook, a supplier page. Replaces the existing list.",
        },
        thumbnail_url: STR("Url of the reference/hero image for this design."),
        estimated_cost: { type: "number", description: "New estimated cost." },
        cost_currency: STR("Currency code for estimated_cost."),
        colors: {
          type: "array",
          description: "Replacement colourway. Each: { name, hex_code, usage_notes?, order? }.",
          items: obj(
            { name: STR("Colour name."), hex_code: STR("Hex code.") },
            ["name", "hex_code"]
          ),
        },
        size_sets: {
          type: "array",
          description:
            "Replacement size sets. Each: { size_label, measurements: { <point>: number } }. This REPLACES the existing sets — send the full list.",
          items: obj(
            {
              size_label: STR("Size label, e.g. 'M'."),
              measurements: { type: "object", description: "Measurement point -> numeric value." },
            },
            ["size_label", "measurements"]
          ),
        },
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id"]
    ),
    sideEffects: "Setting status to 'Approved' here does NOT create a product — that is a separate approval action in the UI.",
  },
  {
    name: "link_design_partners",
    description:
      "Link one or more partners to a design, making them eligible for its production runs. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/:id/partner",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["partnerIds"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        partnerIds: {
          type: "array",
          items: { type: "string" },
          description: "Partner ids to link to the design (required).",
        },
      },
      ["id", "partnerIds"]
    ),
    nextSteps: ["create_design_production_run"],
  },
  {
    name: "unlink_design_partner",
    description:
      "Unlink a partner from a design. Refused while that partner still has active production runs on the design — use cancel_design_partner_assignment for that. Sensitive: requires confirm:true.",
    method: "DELETE",
    path: "/admin/designs/:id/partner",
    pathParams: ["id"],
    write: true,
    bodyParams: ["partnerId"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        partnerId: STR("Partner id to unlink (required)."),
      },
      ["id", "partnerId"]
    ),
  },
  {
    name: "create_design_production_run",
    description:
      "Create a production run for a design and, when assignments are supplied, approve it and auto-dispatch the named task templates in one shot. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/:id/production-runs",
    pathParams: ["id"],
    previewPath: "/admin/designs/:id",
    write: true,
    sensitive: true,
    bodyParams: ["quantity", "run_type", "assignments"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        quantity: {
          type: "number",
          description:
            "Total units. If both quantity and assignments are given, the assignment quantities MUST sum to this.",
        },
        run_type: STR("'production' (default) | 'sample'."),
        assignments: {
          type: "array",
          description:
            "Partner assignments. Each: { partner_id (required), quantity (required), role?, order?, template_names? }. Omit entirely to create an unassigned run.",
          items: obj(
            {
              partner_id: STR("Partner to assign (required)."),
              quantity: { type: "number", description: "Units for this partner (required)." },
              role: STR("Role this partner plays."),
              order: { type: "integer", description: "Dispatch sequence position." },
              template_names: {
                type: "array",
                items: { type: "string" },
                description: "Task templates to auto-dispatch for this partner.",
              },
            },
            ["partner_id", "quantity"]
          ),
        },
      },
      ["id"]
    ),
    sideEffects: "With assignments, this also approves the run and fans out child runs — not just a draft.",
    nextSteps: ["list_production_runs", "get_production_run"],
  },
  {
    name: "produce_designs",
    description:
      "Send a batch of designs to one partner for production (no customer order involved): one run per design, each DISPATCHED with its own task templates, collated into a single work-order. Pass dry_run:true first to see which design gets which templates. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/produce",
    write: true,
    sensitive: true,
    bodyParams: [
      "design_ids",
      "designs",
      "partner_id",
      "template_ids",
      "dry_run",
    ],
    inputSchema: obj(
      {
        designs: {
          type: "array",
          description:
            "Preferred. Per design: { design_id, template_ids?, quantity? }. Templates are per design — a batch rarely shares one process.",
          items: obj(
            {
              design_id: STR("Design to produce."),
              template_ids: {
                type: "array",
                items: { type: "string" },
                description:
                  "Task template IDS (not names — an ambiguous name is refused at dispatch).",
              },
              quantity: { type: "number", description: "Defaults to 1." },
            },
            ["design_id"]
          ),
        },
        design_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Design ids to produce. Use with template_ids when the whole batch shares one process; otherwise prefer `designs`.",
        },
        partner_id: STR("Partner to assign every created run to (required)."),
        template_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Fallback template ids for designs without their own selection. A design left with none is created but NOT dispatched, and is reported in not_dispatched.",
        },
        dry_run: {
          type: "boolean",
          description:
            "Preview the design → templates plan and create nothing.",
        },
      },
      ["partner_id"]
    ),
    sideEffects:
      "Dispatches each design to the partner (creates tasks and notifies). Designs with no template selection are created without tasks and listed under not_dispatched.",
    nextSteps: ["list_design_work_orders"],
  },
  {
    name: "recreate_design_production_run",
    description:
      "Redo / rework: create a fresh production run for a set of designs with one partner, on top of whatever already exists. Sensitive: requires confirm:true. Use this after a run went wrong, not to make the first run.",
    method: "POST",
    path: "/admin/designs/recreate-production-run",
    write: true,
    sensitive: true,
    bodyParams: ["designs", "partner_id", "run_type", "notes", "metadata"],
    inputSchema: obj(
      {
        designs: {
          type: "array",
          description: "Designs to remake. Each: { design_id, quantity, notes? }.",
          items: obj(
            {
              design_id: STR("Design id."),
              quantity: { type: "number", description: "Units to remake." },
            },
            ["design_id", "quantity"]
          ),
        },
        partner_id: STR("Partner to assign the rework to (required)."),
        run_type: STR("'production' (default) | 'sample'."),
        notes: STR("Why this rework is happening."),
        metadata: { type: "object", description: "Optional key/value metadata." },
      },
      ["designs", "partner_id"]
    ),
    sideEffects: "Adds NEW runs — it does not cancel or replace the original ones. Cancel those separately if they are dead.",
  },
  {
    name: "cancel_design_partner_assignment",
    description:
      "Back out a partner from a design: cancels that partner's production runs and open tasks on it, and optionally unlinks them. This is the safe reversal for create_design_production_run / produce_designs. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/:id/cancel-partner-assignment",
    pathParams: ["id"],
    previewPath: "/admin/designs/:id",
    write: true,
    sensitive: true,
    bodyParams: ["partner_id", "unlink"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        partner_id: STR("Partner whose assignment is being cancelled (required)."),
        unlink: {
          type: "boolean",
          description: "Also unlink the partner from the design (default false).",
        },
      },
      ["id", "partner_id"]
    ),
    sideEffects: "Cancels the partner's runs and open tasks on this design. Cancelled runs are terminal.",
  },
  {
    name: "update_design_task",
    description:
      "Update a task on a design (title, description, status, priority, dates). Sensitive: requires confirm:true. Use dry_run to see the current task first.",
    method: "POST",
    path: "/admin/designs/:id/tasks/:taskId",
    pathParams: ["id", "taskId"],
    previewPath: "/admin/designs/:id/tasks/:taskId",
    write: true,
    sensitive: true,
    bodyParams: [
      "title",
      "description",
      "status",
      "priority",
      "start_date",
      "end_date",
      "metadata",
    ],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        taskId: STR("Task id, e.g. 'task_...'."),
        title: STR("New title."),
        description: STR("New description."),
        status: STR(
          "New status — one of exactly: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'accepted'."
        ),
        priority: STR("New priority — one of exactly: 'low' | 'medium' | 'high'."),
        start_date: STR("New start date (ISO string)."),
        end_date: STR("New due date (ISO string)."),
        metadata: { type: "object", description: "Metadata to merge." },
      },
      ["id", "taskId"]
    ),
  },
  {
    name: "assign_design_task",
    description:
      "Assign a design's task to a partner and notify them. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/:id/tasks/:taskId/assign",
    pathParams: ["id", "taskId"],
    write: true,
    sensitive: true,
    bodyParams: ["taskId", "partnerId"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        taskId: STR("Task id to assign, e.g. 'task_...'."),
        partnerId: STR("Partner id to assign the task to (required)."),
      },
      ["id", "taskId", "partnerId"]
    ),
    sideEffects: "Links the task to the partner and notifies them.",
  },

  // ===== Images, materials and the idea -> design pipeline ================
  // Everything here already existed as an admin route; what was missing was the
  // assistant's ability to reach it. Two operator journeys drive the selection:
  //   1. "here's a photo of what arrived" -> raw materials + inventory
  //   2. "here's an idea and a reference"  -> design + attributes + construction
  //      details + materials + partner + production run
  {
    name: "read_image",
    description:
      "Look at an image and answer a question about it (transcribe handwriting, describe a garment, read a label). Costs a real vision call and can take 30s — only use it when the operator asks, or when their request is impossible without seeing the image. Attaching an image is NOT a reason to read it.",
    method: "POST",
    path: "/admin/assistant/vision",
    bodyParams: ["image_url", "prompt", "model"],
    inputSchema: obj(
      {
        image_url: STR("Url of the image to read — take it from an [attachment] line."),
        prompt: STR(
          "The specific question to ask about the image. Be narrow: broad prompts on reasoning models can exhaust the token budget before they answer."
        ),
        model: STR(
          "Optional model override, e.g. '@cf/meta/llama-4-scout-17b-16e-instruct' for a fast read or '@cf/google/gemma-4-26b-a4b-it' for an accurate one. Omit to use the configured ai_image_extraction platform."
        ),
      },
      ["image_url"]
    ),
    sideEffects:
      "Reads the image with a separately-configured vision model and returns text. Stores nothing and changes no records. Failures are configuration problems, not transient ones — relay the message rather than retrying.",
  },
  {
    name: "extract_inventory_from_image",
    description:
      "Read a photo of fabric/trims/a delivery note and turn it into raw materials + inventory items. Run it with persist:false first to show the operator what was found; only persist:true creates records. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/ai/image-extraction",
    write: true,
    sensitive: true,
    bodyParams: [
      "image_url",
      "entity_type",
      "notes",
      "hints",
      "verify",
      "persist",
      "defaults",
    ],
    inputSchema: obj(
      {
        image_url: STR("Url of the image to extract from."),
        entity_type: STR(
          "What to extract, e.g. 'raw_material' for fabric/trims or 'product'."
        ),
        notes: STR("Extra context for the extraction, in the operator's words."),
        hints: {
          type: "array",
          items: { type: "string" },
          description: "Hints that steer the extraction, e.g. 'metres not yards'.",
        },
        verify: {
          type: "boolean",
          description: "Ask the model to double-check its own extraction.",
        },
        persist: {
          type: "boolean",
          description:
            "Create the raw materials and inventory items. Default false — preview first, always.",
        },
        defaults: {
          type: "object",
          description:
            "Fallbacks for fields the image doesn't state: { notes, raw_materials: { width_inch, material_type }, inventory: { stock_location_id, default_stocked_quantity, default_incoming_quantity, incoming_from_extraction } }.",
        },
      },
      ["image_url", "entity_type"]
    ),
    sideEffects:
      "With persist:true, creates raw material records, inventory items and stock levels.",
    nextSteps: ["list_raw_materials", "link_design_inventory"],
  },
  {
    name: "list_raw_materials",
    description:
      "List raw materials (the inventory items that carry raw-material data: composition, unit of measure, unit cost).",
    method: "GET",
    path: "/admin/inventory-items/raw-materials",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "add_inventory_raw_material",
    description:
      "Attach raw-material data (composition, unit of measure, cost, material type) to an existing inventory item. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/inventory-items/:id/rawmaterials",
    pathParams: ["id"],
    previewPath: "/admin/inventory-items/:id",
    write: true,
    sensitive: true,
    bodyParams: ["rawMaterialData"],
    inputSchema: obj(
      {
        id: STR("Inventory item id, e.g. 'iitem_...'."),
        rawMaterialData: {
          type: "object",
          description:
            "{ name, composition, unit_of_measure?, unit_cost?, material_type? (a category NAME, find-or-create) or material_type_id?, specifications?, media? }.",
        },
      },
      ["id", "rawMaterialData"]
    ),
  },
  {
    name: "list_raw_material_groups",
    description:
      "List raw material groups — the colourway/spec families that designs pin their materials to.",
    method: "GET",
    path: "/admin/raw-material-groups",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "create_raw_material_group",
    description:
      "Create a raw material group holding the specs its colours inherit (composition, unit of measure, material type, cost). Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/raw-material-groups",
    write: true,
    sensitive: true,
    bodyParams: [
      "name",
      "description",
      "status",
      "composition",
      "specifications",
      "dimensions",
      "unit_of_measure",
      "material_type",
      "material_type_id",
      "unit_cost",
      "cost_currency",
      "lead_time_days",
      "minimum_order_quantity",
      "stock_location_id",
      "metadata",
    ],
    inputSchema: obj(
      {
        name: STR("Group name (required)."),
        description: STR("What this group covers."),
        status: STR("Group status."),
        composition: STR("e.g. '100% organic cotton'."),
        specifications: { type: "object", description: "Arbitrary spec key/values." },
        dimensions: {
          type: "array",
          items: { type: "object" },
          description: "[{ key, label, values? }] — the group's variant axes.",
        },
        unit_of_measure: STR("Meter, Kilogram, Gram, Yard, Roll, Piece, ..."),
        material_type: STR("Category NAME — resolved/created server-side."),
        material_type_id: STR("Existing material type id, if known."),
        unit_cost: { type: "number", description: "Cost per unit." },
        cost_currency: STR("e.g. 'inr'."),
        lead_time_days: { type: "integer", description: "Supplier lead time." },
        minimum_order_quantity: { type: "integer", description: "MOQ." },
        stock_location_id: STR("Default stock location."),
        metadata: { type: "object", description: "Free-form metadata." },
      },
      ["name"]
    ),
    nextSteps: ["link_design_material_group"],
  },
  {
    name: "link_design_inventory",
    description:
      "Link inventory items to a design as its bill of materials, with planned quantities. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/:id/inventory",
    pathParams: ["id"],
    previewPath: "/admin/designs/:id/inventory",
    write: true,
    sensitive: true,
    bodyParams: ["inventoryIds", "inventoryItems"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        inventoryIds: {
          type: "array",
          items: { type: "string" },
          description: "Inventory item ids to link.",
        },
        inventoryItems: {
          type: "array",
          items: { type: "object" },
          description:
            "Detailed links instead of bare ids: [{ inventoryId, plannedQuantity?, locationId?, metadata? }].",
        },
      },
      ["id"]
    ),
    nextSteps: ["list_design_inventory", "create_design_production_run"],
  },
  {
    name: "list_design_material_groups",
    description: "List the raw material groups pinned to a design.",
    method: "GET",
    path: "/admin/designs/:id/material-groups",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Design id, e.g. 'design_...'.") }, ["id"]),
  },
  {
    name: "link_design_material_group",
    description:
      "Pin a raw material group to a design — the Materials frame of its tech pack. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/:id/material-groups",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: [
      "raw_material_group_id",
      "resolved_raw_material_id",
      "note",
      "metadata",
    ],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        raw_material_group_id: STR("Raw material group id to pin (required)."),
        resolved_raw_material_id: STR(
          "The specific colour/material chosen from the group, if decided."
        ),
        note: STR("Why this material, in the designer's words."),
        metadata: { type: "object", description: "Free-form metadata." },
      },
      ["id", "raw_material_group_id"]
    ),
  },
  {
    name: "list_construction_techniques",
    description:
      "List the canonical construction techniques a design can use — slug, label, family, garment areas, tunable params and ready-made presets. Call this BEFORE add_design_construction_detail: only these slugs are accepted.",
    method: "GET",
    path: "/admin/designs/:id/construction-techniques",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Design id, e.g. 'design_...'.") }, ["id"]),
    nextSteps: ["add_design_construction_detail"],
  },
  {
    name: "list_design_construction_details",
    description:
      "List a design's construction details (its Construction specifications — the tech-pack construction frame).",
    method: "GET",
    path: "/admin/designs/:id/construction-details",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Design id, e.g. 'design_...'.") }, ["id"]),
  },
  {
    name: "add_design_construction_detail",
    description:
      "Add a construction detail to a design (dart, pleat, gather, topstitch, yoke, embroidery...). `technique` MUST be a slug from list_construction_techniques — free text is rejected. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/:id/construction-details",
    pathParams: ["id"],
    previewPath: "/admin/designs/:id/construction-details",
    write: true,
    sensitive: true,
    bodyParams: ["technique", "label", "params", "fabricRules", "note"],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        technique: STR(
          "Technique slug from list_construction_techniques, e.g. 'dart', 'knife-pleat'."
        ),
        label: STR("Display label. Defaults to the technique's own label."),
        params: {
          type: "object",
          description:
            "Numeric params for the technique, e.g. { intake: 0.6 }. Omit to take the technique's defaults.",
        },
        fabricRules: {
          type: "array",
          items: { type: "string" },
          description: "Sewing/fabric rules, e.g. 'press toward centre front'.",
        },
        note: STR("Anything the maker needs to know."),
      },
      ["id", "technique"]
    ),
    sideEffects:
      "Creates a Construction specification on the design. Its params are the numbers the tech-pack renderer draws, so prefer a preset's values over invented ones.",
  },
  {
    name: "update_design_brief",
    description:
      "Set a design's brief — the attributes that describe the idea rather than the garment: concept theme, aesthetic keywords, target persona, competitors, price point, budget and milestones. Partial: only the keys you pass change. Sensitive: requires confirm:true.",
    method: "PUT",
    path: "/admin/designs/:id/brief",
    pathParams: ["id"],
    previewPath: "/admin/designs/:id/brief",
    write: true,
    sensitive: true,
    bodyParams: [
      "concept_theme",
      "aesthetic_keywords",
      "persona",
      "competitors",
      "price_point",
      "design_budget",
      "cost_currency",
      "milestones",
    ],
    inputSchema: obj(
      {
        id: STR("Design id, e.g. 'design_...'."),
        concept_theme: STR("Short story/title for the concept, e.g. '90s Tokyo streetwear'."),
        aesthetic_keywords: {
          type: "array",
          items: { type: "string" },
          description: "3-5 keywords defining the look, e.g. ['utilitarian','nostalgic'].",
        },
        persona: {
          type: "object",
          description: "{ age_range, lifestyle, values[], pain_points[] }.",
        },
        competitors: {
          type: "array",
          items: { type: "object" },
          description: "[{ name, url?, differentiator }].",
        },
        price_point: STR("'luxury' | 'mid_market' | 'budget'."),
        design_budget: { type: "number", description: "Design-phase budget." },
        cost_currency: STR("e.g. 'inr'."),
        milestones: {
          type: "array",
          items: { type: "object" },
          description: "[{ label, date? }] in order.",
        },
      },
      ["id"]
    ),
  },
  {
    name: "search_pinterest",
    description:
      "Search Pinterest for reference images by keyword. Returns pins with image urls that can be read with read_image or recorded on a design as inspiration. Requires PINTEREST_ACCESS_TOKEN to be configured.",
    method: "GET",
    path: "/admin/pinterest",
    queryParams: ["q", "bookmark"],
    inputSchema: obj(
      {
        q: STR("Search query, e.g. 'indigo block print kurta'."),
        bookmark: STR("Cursor from a previous response, for the next page."),
      },
      ["q"]
    ),
    nextSteps: ["read_image", "create_design"],
  },

  // ===== Data Plumbing (audited operational corrections) ==================
  // These wrap the #457 maintenance-job surface. Every run is persisted to
  // `ops_maintenance_run` with the acting admin, so assistant-driven repairs
  // carry the same audit trail as hand-run ones.
  {
    name: "list_maintenance_jobs",
    description:
      "List the available Data Plumbing maintenance jobs — audited, guarded data corrections (repair a reversed inventory-order route, backfill a field, reconcile a mirror). Returns each job's id, label, description and parameter schema. Start here when an operator reports data that looks wrong rather than code that looks wrong.",
    method: "GET",
    path: "/admin/ops/maintenance-jobs",
    inputSchema: obj({}),
    nextSteps: ["run_maintenance_job", "list_maintenance_job_runs"],
  },
  {
    name: "list_maintenance_job_runs",
    description:
      "Read the maintenance-job audit log — who ran what, when, dry-run or applied, and the change set. Use it to check whether a repair has already been attempted before running another.",
    method: "GET",
    path: "/admin/ops/maintenance-jobs/runs",
    queryParams: ["limit", "offset", "job_id"],
    inputSchema: obj({
      ...PAGINATION,
      job_id: STR("Only runs of this job id, e.g. 'repair-inventory-order-route'."),
    }),
  },
  {
    name: "run_maintenance_job",
    description:
      "Run a Data Plumbing maintenance job. SAFE BY DEFAULT: dry_run defaults to true and previews the exact change set without writing — always preview and show the operator the changes before applying. Pass dry_run:false to apply, which requires confirm:true. Per-job params are validated by the job itself; call list_maintenance_jobs first for the schema.",
    method: "POST",
    path: "/admin/ops/maintenance-jobs/:id/run",
    pathParams: ["id"],
    bodyParams: ["dry_run", "params"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      {
        id: STR("Maintenance job id, e.g. 'repair-inventory-order-route'."),
        dry_run: {
          type: "boolean",
          description:
            "Preview only. Defaults to true — pass false to actually apply.",
        },
        params: {
          type: "object",
          description:
            "Job-specific parameters. See the job's `params` from list_maintenance_jobs.",
          additionalProperties: true,
        },
      },
      ["id"]
    ),
    sideEffects:
      "With dry_run:false, mutates production data as described by the job. Every run is written to the ops_maintenance_run audit log.",
    nextSteps: ["list_maintenance_job_runs"],
  },

  // ===== Tier 2: the first dangerous action ==============================
  // Platform-destructive: hidden + refused unless ADMIN_MCP_ENABLE_DANGEROUS is
  // on, and even then requires BOTH confirm:true AND a human-supplied reason.
  {
    name: "delete_product",
    description:
      "Permanently delete a product. PLATFORM-DESTRUCTIVE: requires confirm:true AND a human reason, and is only available when ADMIN_MCP_ENABLE_DANGEROUS is enabled. Always dry_run first.",
    method: "DELETE",
    path: "/admin/products/:id",
    pathParams: ["id"],
    previewPath: "/admin/products/:id",
    write: true,
    dangerous: true,
    inputSchema: obj({ id: STR("Product id to delete, e.g. 'prod_...'.") }, ["id"]),
    sideEffects: "Irreversibly removes the product and its variants from the catalog.",
  },
]
