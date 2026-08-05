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
    queryParams: ["limit", "offset", "q", "status", "kind"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional order status filter."),
      kind: STR(
        "Which order family to list: 'retail' (default) | 'design' | 'inventory' | 'all'."
      ),
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
      "Update a production run's quantity, role, run type or partner cost estimate. Sensitive: requires confirm:true. Structural edits (quantity/role/run_type) are REJECTED once the run has been accepted or started, and any edit is rejected on a cancelled run. Use dry_run to see the current run first.",
    method: "POST",
    path: "/admin/production-runs/:id",
    pathParams: ["id"],
    previewPath: "/admin/production-runs/:id",
    write: true,
    sensitive: true,
    bodyParams: ["quantity", "role", "run_type", "partner_cost_estimate", "cost_type"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        quantity: { type: "number", description: "New quantity (pre-acceptance only)." },
        role: STR("New role for the run (pre-acceptance only)."),
        run_type: STR("'production' | 'sample' (pre-acceptance only)."),
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
    bodyParams: ["template_names"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        template_names: {
          type: "array",
          items: { type: "string" },
          description: "Task template names to instantiate (required, non-empty).",
        },
      },
      ["id", "template_names"]
    ),
    sideEffects: "Creates partner tasks from the templates and notifies the assigned partner.",
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
    bodyParams: ["template_names", "transaction_id"],
    inputSchema: obj(
      {
        id: STR("Production run id."),
        template_names: {
          type: "array",
          items: { type: "string" },
          description: "Task template names to dispatch (required, non-empty).",
        },
        transaction_id: STR("The transaction_id returned by start_production_run_dispatch (required)."),
      },
      ["id", "template_names", "transaction_id"]
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
      "Send a batch of designs to one partner for production (no customer order involved): creates one run per design, collated into a single work-order. Sensitive: requires confirm:true.",
    method: "POST",
    path: "/admin/designs/produce",
    write: true,
    sensitive: true,
    bodyParams: ["design_ids", "partner_id"],
    inputSchema: obj(
      {
        design_ids: {
          type: "array",
          items: { type: "string" },
          description: "Design ids to produce (required, non-empty).",
        },
        partner_id: STR("Partner to assign every created run to (required)."),
      },
      ["design_ids", "partner_id"]
    ),
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
