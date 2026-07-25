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
