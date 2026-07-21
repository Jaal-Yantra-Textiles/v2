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
 * Tier 1 is read-only breadth. Tier 2 (below) adds the first writes — catalog
 * updates (sensitive: require confirm) and the first `dangerous` action
 * (delete_product: confirm + reason, gated by ADMIN_MCP_ENABLE_DANGEROUS) —
 * plus the MCP-observability read (`get_mcp_usage`) and the resolver capability
 * carried over from the deprecated V4 chat (`resolve_admin_query`). Later tiers
 * add production, money, CRM/investor and marketing tools (see epic #1092).
 */
import type { McpToolDef } from "../../../../lib/mcp-core"

/** Admin tool definition. Alias of the shared core tool model. */
export type AdminMcpToolDef = McpToolDef

export { renderToolGuidance } from "../../../../lib/mcp-core"

// ---- Reusable JSON-Schema fragments ---------------------------------------

const STR = (description: string) => ({ type: "string", description })

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
      "List orders (paginated). Supports free-text search via q. Use to answer 'what orders came in', revenue/volume, and to find an order id.",
    method: "GET",
    path: "/admin/orders",
    queryParams: ["limit", "offset", "q", "status"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional order status filter."),
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
    description: "List products (paginated). Supports free-text search via q.",
    method: "GET",
    path: "/admin/products",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
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
    description: "List customers (paginated). Supports free-text search via q.",
    method: "GET",
    path: "/admin/customers",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
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
    description: "List designs (paginated). Supports free-text search via q.",
    method: "GET",
    path: "/admin/designs",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
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
      "List production runs / work orders (paginated). Use to see open runs, their stage and assigned partner.",
    method: "GET",
    path: "/admin/production-runs",
    queryParams: ["limit", "offset", "q", "status"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional run status filter."),
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
