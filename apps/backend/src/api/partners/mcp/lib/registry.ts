/**
 * Declarative registry of Partner API endpoints exposed as MCP / chat tools.
 *
 * Each entry maps one tool -> one `/partners/*` route. The dispatcher (see
 * dispatch.ts) is a thin loopback proxy: it forwards the tool arguments to the
 * real partner route (proxy.ts), so every tool inherits the route's
 * `authenticate("partner", …)` ownership scoping, `validateAndTransformBody`
 * validators, and workflow logic — for free. Wrapping a new endpoint is one row.
 *
 * Input schemas are plain JSON Schema (not zod) on purpose: they are returned
 * verbatim to MCP clients in `tools/list`, and the chat route wraps them with
 * the AI-SDK `jsonSchema()` helper — so there is a single source of truth that
 * feeds both the external MCP endpoint and the in-app assistant.
 *
 * Two safety rails the dispatcher enforces from these flags:
 *  - `dry_run` (accepted by EVERY tool): return the planned request — and, for
 *    writes with a `previewPath`, the current object — WITHOUT executing. Lets
 *    the model rehearse a mutation and inspect live data before firing.
 *  - `sensitive` (+ every DELETE): require an explicit `confirm: true` before
 *    executing. Called without it, the tool returns `requires_confirmation` so
 *    the UI can surface an approval card. Everything else executes directly.
 */

export type PartnerMcpToolDef = {
  /** Tool name surfaced to the agent (snake_case). */
  name: string
  /** One-line description shown in `tools/list` and to the model. */
  description: string
  /** JSON Schema for the domain arguments (dry_run/confirm are injected). */
  inputSchema: Record<string, any>
  /** HTTP method of the wrapped partner route. GET = read (always exposed). */
  method?: "GET" | "POST" | "PUT" | "DELETE"
  /** Partner route path, with `:param` placeholders, e.g. `/partners/products/:id`. */
  path?: string
  /** Names of `:param` placeholders that must be supplied as arguments. */
  pathParams?: string[]
  /** Argument keys forwarded to the route as query-string params. */
  queryParams?: string[]
  /** Argument keys assembled into the JSON request body (write tools only). */
  bodyParams?: string[]
  /** Non-GET tool: gated behind the write flag on the server. */
  write?: boolean
  /**
   * High-stakes mutation: requires `confirm: true` to execute. Called without
   * it, the dispatcher returns a `requires_confirmation` plan. Every DELETE is
   * treated as sensitive implicitly; set this to flag sensitive POST/PUTs too.
   */
  sensitive?: boolean
  /**
   * Companion GET path (same `:param` substitution) used during `dry_run` to
   * fetch the current object so the model can see what it is about to change.
   */
  previewPath?: string
  /** Optional pure post-processor applied to a successful response. */
  transform?: (data: any, args: Record<string, unknown>) => any
}

// ---- Reusable JSON-Schema fragments ---------------------------------------

const STR = (description: string) => ({ type: "string", description })
const BOOL = (description: string) => ({ type: "boolean", description })
const INT = (description: string) => ({ type: "integer", description })

/** Pagination props shared by list tools. */
const PAGINATION = {
  limit: { type: "integer", description: "Max results (default 20)." },
  offset: { type: "integer", description: "Pagination offset." },
  q: { type: "string", description: "Free-text search filter." },
} as const

const obj = (
  properties: Record<string, any>,
  required: string[] = []
): Record<string, any> => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})

/** Unit-of-measure enum shared by consumption-log tools. */
const UOM = {
  type: "string",
  description: "Unit of measure.",
  enum: [
    "Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll",
    "kWh", "Liter", "Cubic_Meter", "Hour", "Other",
  ],
} as const

/** Consumption category enum shared by consumption-log tools. */
const CONSUMPTION_TYPE = {
  type: "string",
  description: "What the consumption represents.",
  enum: [
    "sample", "production", "wastage",
    "energy_electricity", "energy_water", "energy_gas", "labor",
  ],
} as const

/** Body params + schema for a consumption-log write (design & production run). */
const CONSUMPTION_LOG_BODY = [
  "inventoryItemId", "rawMaterialId", "productionRunId", "quantity",
  "unitCost", "unitOfMeasure", "consumptionType", "notes", "locationId", "metadata",
]
const consumptionLogSchema = (withRun: boolean) =>
  obj(
    {
      inventoryItemId: STR("Inventory item consumed, e.g. 'iitem_...'."),
      rawMaterialId: STR("Optional raw-material id."),
      ...(withRun ? { productionRunId: STR("Optional production-run id.") } : {}),
      quantity: { type: "number", description: "Quantity consumed (> 0)." },
      unitCost: { type: "number", description: "Optional unit cost." },
      unitOfMeasure: UOM,
      consumptionType: CONSUMPTION_TYPE,
      notes: STR("Optional notes."),
      locationId: STR("Optional stock-location id."),
      metadata: { type: "object", additionalProperties: true },
    },
    ["inventoryItemId", "quantity"]
  )

// ---- The registry ----------------------------------------------------------

export const PARTNER_MCP_TOOLS: PartnerMcpToolDef[] = [
  // ===== Profile & persona (onboarding) =====================================
  {
    name: "get_partner_profile",
    description:
      "Get the current partner's profile (name, handle, workspace_type/persona, status, metadata). Call this first to understand who you are helping and how far onboarding has progressed.",
    method: "GET",
    path: "/partners/me",
    inputSchema: obj({}),
  },
  {
    name: "update_partner_profile",
    description:
      "Update the current partner's profile: name, handle, workspace_type (persona: 'seller' | 'manufacturer' | 'individual' | 'designer'), whatsapp_number, country_code (2-letter), currency_code (3-letter), or metadata. Only pass the fields you want to change. Use this to set the partner's persona during onboarding.",
    method: "PUT",
    path: "/partners/update",
    write: true,
    previewPath: "/partners/me",
    bodyParams: [
      "name",
      "handle",
      "workspace_type",
      "whatsapp_number",
      "country_code",
      "currency_code",
      "metadata",
    ],
    inputSchema: obj({
      name: STR("Business / partner display name."),
      handle: STR("URL handle (careful: changing it can affect storefront URLs)."),
      workspace_type: {
        type: "string",
        enum: ["seller", "manufacturer", "individual", "designer"],
        description: "Persona. Determines the default sidebar/home layout.",
      },
      whatsapp_number: STR("WhatsApp number in international format."),
      country_code: STR("2-letter country code, e.g. 'in'."),
      currency_code: STR("3-letter currency code, e.g. 'inr'."),
      metadata: {
        type: "object",
        description:
          "Arbitrary metadata. NOTE: this REPLACES the metadata column — always merge with existing metadata from get_partner_profile first. Set metadata.onboarding_essentials_done=true once name + persona are set.",
        additionalProperties: true,
      },
    }),
  },
  {
    name: "get_onboarding_profile",
    description:
      "Read the partner's onboarding questionnaire (what they sell, price range, person_type, team size, payment/selling mode, completion flag). Returns null-ish if the wizard hasn't been started.",
    method: "GET",
    path: "/partners/onboarding-profile",
    inputSchema: obj({}),
  },
  {
    name: "update_onboarding_profile",
    description:
      "Upsert the partner's onboarding questionnaire. Only supplied fields are written (partial progress is fine). Use during a guided onboarding conversation to record the partner's answers.",
    method: "PUT",
    path: "/partners/onboarding-profile",
    write: true,
    previewPath: "/partners/onboarding-profile",
    bodyParams: [
      "what_they_sell",
      "price_range",
      "has_inventory_info",
      "does_stock",
      "does_weaving",
      "person_type",
      "team_size",
      "payment_collection",
      "selling_mode",
      "commission_bps",
      "supplies_to_platform",
      "completed",
    ],
    inputSchema: obj({
      what_they_sell: {
        type: "string",
        enum: ["apparel", "home_textiles", "fabric", "yarn", "accessories", "other"],
      },
      price_range: {
        type: "string",
        enum: ["economy", "mid", "premium", "luxury"],
      },
      has_inventory_info: BOOL("Whether they can share inventory info."),
      does_stock: BOOL("Whether they hold stock."),
      does_weaving: BOOL("Whether they weave themselves."),
      person_type: {
        type: "string",
        enum: [
          "individual",
          "business",
          "manufacturer",
          "wholesaler",
          "retailer",
          "artisan",
          "other",
        ],
      },
      team_size: INT("Team size (0–100000)."),
      payment_collection: {
        type: "string",
        enum: ["through_us", "themselves"],
      },
      selling_mode: {
        type: "string",
        enum: ["dedicated_storefront", "core_channel_listing"],
      },
      commission_bps: INT("Commission in basis points (0–10000)."),
      supplies_to_platform: BOOL("Whether they supply to the platform."),
      completed: BOOL("Mark the questionnaire complete."),
    }),
  },

  // ===== UI layout personalization =========================================
  {
    name: "list_layout_configurations",
    description:
      "List all of the partner's saved UI layout configurations across zones (e.g. 'sidebar.main', 'home'), including personal overrides and partner-wide defaults.",
    method: "GET",
    path: "/partners/layouts/configurations",
    queryParams: ["limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "get_layout_configuration",
    description:
      "Get the partner's layout configuration for one zone (personal + default + which scope is active). Zones: 'sidebar.main', 'home'.",
    method: "GET",
    path: "/partners/layouts/:zone/configuration",
    pathParams: ["zone"],
    inputSchema: obj(
      { zone: STR("Layout zone, e.g. 'sidebar.main' or 'home'.") },
      ["zone"]
    ),
  },
  {
    name: "set_layout_configuration",
    description:
      "Set the partner's layout configuration for a zone. `configuration.widgets` is a map of widgetId -> { hidden?, section?, order? }. is_default=false sets a personal override; is_default=true sets the partner-wide default. Use this to reorder/hide sidebar or home widgets.",
    method: "POST",
    path: "/partners/layouts/:zone/configuration",
    pathParams: ["zone"],
    write: true,
    previewPath: "/partners/layouts/:zone/configuration",
    bodyParams: ["is_default", "configuration"],
    inputSchema: obj(
      {
        zone: STR("Layout zone, e.g. 'sidebar.main' or 'home'."),
        is_default: BOOL("True = partner-wide default; false = personal override."),
        configuration: {
          type: "object",
          description:
            "{ widgets: Record<widgetId, { hidden?: boolean, section?: string, order?: number }> }",
          additionalProperties: true,
        },
      },
      ["zone", "configuration"]
    ),
  },
  {
    name: "reset_layout_configuration",
    description:
      "Remove the partner's personal layout override for a zone (reset to the default). The partner-wide default row is left intact.",
    method: "DELETE",
    path: "/partners/layouts/:zone/configuration",
    pathParams: ["zone"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      { zone: STR("Layout zone to reset, e.g. 'sidebar.main' or 'home'.") },
      ["zone"]
    ),
  },

  // ===== Read-only breadth across partner resources ========================
  {
    name: "list_orders",
    description: "List the partner's orders (paginated). Supports free-text search via q.",
    method: "GET",
    path: "/partners/orders",
    queryParams: ["limit", "offset", "q", "status"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional order status filter."),
    }),
  },
  {
    name: "list_products",
    description: "List the partner's products (paginated). Supports free-text search via q.",
    method: "GET",
    path: "/partners/products",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "get_product",
    description: "Get a single partner product by id.",
    method: "GET",
    path: "/partners/products/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Product id, e.g. 'prod_...'.") }, ["id"]),
  },
  {
    name: "list_stores",
    description: "List the partner's storefronts / stores.",
    method: "GET",
    path: "/partners/stores",
    queryParams: ["limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "create_store",
    description:
      "Create a storefront/store for the partner. This is a multi-part setup done in ONE call: it provisions the store, a default sales channel, a region (with its countries + currency), and a stock location (with the partner's address). Use it during onboarding once you know the store name, currency, selling countries, and address. Country codes in `region.countries` are lower-case ISO-2 (e.g. ['in']); `location.address.country_code` is upper-case ISO-2 (e.g. 'IN'). Sensitive — requires confirmation.",
    method: "POST",
    path: "/partners/stores",
    write: true,
    sensitive: true,
    previewPath: "/partners/stores",
    bodyParams: ["store", "sales_channel", "region", "location"],
    inputSchema: obj(
      {
        store: obj(
          {
            name: STR("Store display name, e.g. 'HR Handloom'."),
            supported_currencies: {
              type: "array",
              description: "At least one currency; mark one is_default.",
              minItems: 1,
              items: obj(
                {
                  currency_code: STR("3-letter code, e.g. 'inr'."),
                  is_default: BOOL("Whether this is the default currency."),
                },
                ["currency_code"]
              ),
            },
            metadata: {
              type: "object",
              description: "Optional store metadata.",
              additionalProperties: true,
            },
          },
          ["name", "supported_currencies"]
        ),
        sales_channel: obj({
          name: STR("Optional sales-channel name (defaults are applied)."),
          description: STR("Optional sales-channel description."),
        }),
        region: obj(
          {
            name: STR("Region name, e.g. 'India'."),
            currency_code: STR("3-letter code, e.g. 'inr'."),
            countries: {
              type: "array",
              description: "Lower-case ISO-2 country codes, e.g. ['in'].",
              minItems: 1,
              items: { type: "string", minLength: 2 },
            },
            payment_providers: {
              type: "array",
              description: "Optional payment provider ids.",
              items: { type: "string" },
            },
          },
          ["name", "currency_code", "countries"]
        ),
        location: obj(
          {
            name: STR("Stock location / warehouse name."),
            address: obj(
              {
                address_1: STR("Street address."),
                address_2: STR("Optional second address line."),
                city: STR("City."),
                province: STR("State / province."),
                postal_code: STR("Postal / PIN code."),
                country_code: STR("UPPER-case ISO-2, e.g. 'IN'."),
              },
              ["address_1", "country_code"]
            ),
          },
          ["name", "address"]
        ),
      },
      ["store", "region", "location"]
    ),
  },
  {
    name: "list_designs",
    description: "List the partner's designs / design briefs (paginated).",
    method: "GET",
    path: "/partners/designs",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "list_inventory_items",
    description: "List the partner's inventory items (paginated).",
    method: "GET",
    path: "/partners/inventory-items",
    queryParams: ["limit", "offset", "q"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "list_notifications",
    description: "List the partner's notifications.",
    method: "GET",
    path: "/partners/notifications",
    queryParams: ["limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },

  // ===== Design workflow ====================================================
  {
    name: "get_design",
    description: "Get a single design/brief by id, with its details.",
    method: "GET",
    path: "/partners/designs/:designId",
    pathParams: ["designId"],
    inputSchema: obj({ designId: STR("Design id, e.g. 'design_...'.") }, ["designId"]),
  },
  {
    name: "update_design",
    description:
      "Update a design's fields (name, description, status, colors, sizes, custom fields, metadata, …). Pass only the fields to change. The route validator is the source of truth for allowed keys.",
    method: "PUT",
    path: "/partners/designs/:designId",
    pathParams: ["designId"],
    write: true,
    previewPath: "/partners/designs/:designId",
    bodyParams: ["design"],
    inputSchema: obj(
      {
        designId: STR("Design id to update."),
        design: {
          type: "object",
          description: "Partial design fields to update.",
          additionalProperties: true,
        },
      },
      ["designId", "design"]
    ),
  },
  {
    name: "get_design_cost",
    description: "Get a design's computed cost breakdown.",
    method: "GET",
    path: "/partners/designs/:designId/cost",
    pathParams: ["designId"],
    inputSchema: obj({ designId: STR("Design id.") }, ["designId"]),
  },
  {
    name: "recalculate_design_cost",
    description:
      "Recompute a design's cost from its current consumption logs + material prices. Use after logging consumption.",
    method: "POST",
    path: "/partners/designs/:designId/recalculate-cost",
    pathParams: ["designId"],
    write: true,
    inputSchema: obj({ designId: STR("Design id.") }, ["designId"]),
  },
  {
    name: "list_design_consumption_logs",
    description: "List the raw-material/energy/labor consumption logged against a design.",
    method: "GET",
    path: "/partners/designs/:designId/consumption-logs",
    pathParams: ["designId"],
    inputSchema: obj({ designId: STR("Design id.") }, ["designId"]),
  },
  {
    name: "log_design_consumption",
    description:
      "Record material/energy/labor consumed for a design (feeds its cost). Quantity must be > 0. inventoryItemId is required.",
    method: "POST",
    path: "/partners/designs/:designId/consumption-logs",
    pathParams: ["designId"],
    write: true,
    bodyParams: CONSUMPTION_LOG_BODY,
    inputSchema: {
      ...consumptionLogSchema(true),
      properties: {
        designId: STR("Design id."),
        ...consumptionLogSchema(true).properties,
      },
      required: ["designId", "inventoryItemId", "quantity"],
    },
  },
  {
    name: "add_design_media",
    description:
      "Attach media (image URLs / uploaded media references) to a design. Body shape follows the design-media route.",
    method: "POST",
    path: "/partners/designs/:designId/media",
    pathParams: ["designId"],
    write: true,
    bodyParams: ["media", "images", "urls"],
    inputSchema: obj(
      {
        designId: STR("Design id."),
        media: { type: "array", description: "Media items to attach.", items: { type: "object", additionalProperties: true } },
        images: { type: "array", description: "Alternatively, image URLs.", items: { type: "string" } },
        urls: { type: "array", description: "Alternatively, media URLs.", items: { type: "string" } },
      },
      ["designId"]
    ),
  },

  // ===== Production runs =====================================================
  {
    name: "get_production_run_cost_summary",
    description: "Get the cost summary (materials, energy, labor, totals) for a production run.",
    method: "GET",
    path: "/partners/production-runs/:id/cost-summary",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Production-run id.") }, ["id"]),
  },
  {
    name: "list_production_run_consumption_logs",
    description: "List consumption logged against a production run.",
    method: "GET",
    path: "/partners/production-runs/:id/consumption-logs",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Production-run id.") }, ["id"]),
  },
  {
    name: "log_production_run_consumption",
    description:
      "Record material/energy/labor consumed by a production run. Quantity > 0; inventoryItemId required.",
    method: "POST",
    path: "/partners/production-runs/:id/consumption-logs",
    pathParams: ["id"],
    write: true,
    bodyParams: CONSUMPTION_LOG_BODY,
    inputSchema: {
      ...consumptionLogSchema(false),
      properties: {
        id: STR("Production-run id."),
        ...consumptionLogSchema(false).properties,
      },
      required: ["id", "inventoryItemId", "quantity"],
    },
  },
  {
    name: "accept_production_run",
    description: "Accept an assigned production run (partner agrees to produce it). Sensitive.",
    method: "POST",
    path: "/partners/production-runs/:id/accept",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Production-run id.") }, ["id"]),
  },
  {
    name: "start_production_run",
    description: "Mark a production run as started/in-progress.",
    method: "POST",
    path: "/partners/production-runs/:id/start",
    pathParams: ["id"],
    write: true,
    inputSchema: obj({ id: STR("Production-run id.") }, ["id"]),
  },
  {
    name: "finish_production_run",
    description: "Mark production work finished (before final completion/handover).",
    method: "POST",
    path: "/partners/production-runs/:id/finish",
    pathParams: ["id"],
    write: true,
    inputSchema: obj({ id: STR("Production-run id.") }, ["id"]),
  },
  {
    name: "complete_production_run",
    description: "Complete a production run (final state). Sensitive — this closes it out.",
    method: "POST",
    path: "/partners/production-runs/:id/complete",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Production-run id.") }, ["id"]),
  },
  {
    name: "decline_production_run",
    description: "Decline an assigned production run. Sensitive — the partner refuses the job.",
    method: "POST",
    path: "/partners/production-runs/:id/decline",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Production-run id.") }, ["id"]),
  },

  // ===== Media upload (presigned multipart) =================================
  {
    name: "initiate_media_upload",
    description:
      "Start a multipart media upload; returns an upload id + presigned part URLs. The raw bytes are PUT to those URLs out-of-band, then complete_media_upload is called.",
    method: "POST",
    path: "/partners/medias/uploads/initiate",
    write: true,
    bodyParams: ["file_name", "mime_type", "size", "parts", "folder_id", "metadata"],
    inputSchema: obj(
      {
        file_name: STR("Original file name."),
        mime_type: STR("MIME type, e.g. 'image/jpeg'."),
        size: INT("File size in bytes."),
        parts: INT("Number of parts to split into."),
        folder_id: STR("Optional target folder id."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["file_name", "mime_type"]
    ),
  },
  {
    name: "complete_media_upload",
    description:
      "Finalize a multipart media upload once all parts are uploaded. Returns the stored media record.",
    method: "POST",
    path: "/partners/medias/uploads/complete",
    write: true,
    bodyParams: ["upload_id", "parts", "key", "metadata"],
    inputSchema: obj(
      {
        upload_id: STR("Upload id from initiate."),
        key: STR("Object key from initiate."),
        parts: {
          type: "array",
          description: "Uploaded parts: [{ part_number, etag }].",
          items: { type: "object", additionalProperties: true },
        },
        metadata: { type: "object", additionalProperties: true },
      },
      ["upload_id"]
    ),
  },

  // ===== Products (write) ===================================================
  {
    name: "create_product",
    description:
      "Create a product in one of the partner's stores. Requires store_id and a product object (title, handle, status, options, variants with prices, sales_channels, images, …). The route validator is the source of truth. Sensitive.",
    method: "POST",
    path: "/partners/products",
    write: true,
    sensitive: true,
    bodyParams: ["store_id", "product"],
    inputSchema: obj(
      {
        store_id: STR("Store to create the product in, e.g. 'store_...'."),
        product: {
          type: "object",
          description:
            "Product payload: { title, handle?, status?, description?, options?, variants?, prices?, images?, sales_channels?, … }.",
          additionalProperties: true,
        },
      },
      ["store_id", "product"]
    ),
  },
  {
    name: "resubmit_product",
    description: "Resubmit a product for review/approval after edits.",
    method: "POST",
    path: "/partners/products/:id/resubmit",
    pathParams: ["id"],
    write: true,
    inputSchema: obj({ id: STR("Product id.") }, ["id"]),
  },
  {
    name: "get_product_preview_link",
    description: "Get a shareable storefront preview link for a product (incl. unpublished).",
    method: "GET",
    path: "/partners/products/:id/preview-link",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Product id.") }, ["id"]),
  },
  {
    name: "get_artisan_detail",
    description: "Get a product's artisan/made-to-order details (lead time, min order, maker story).",
    method: "GET",
    path: "/partners/products/:id/artisan-detail",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Product id.") }, ["id"]),
  },
  {
    name: "set_artisan_detail",
    description:
      "Set a product's artisan/made-to-order details: made_to_order, lead_time_days (0–3650), lead_time_label, min_order_quantity (≥1), maker_story.",
    method: "POST",
    path: "/partners/products/:id/artisan-detail",
    pathParams: ["id"],
    write: true,
    previewPath: "/partners/products/:id/artisan-detail",
    bodyParams: [
      "made_to_order", "lead_time_days", "lead_time_label", "min_order_quantity", "maker_story",
    ],
    inputSchema: obj(
      {
        id: STR("Product id."),
        made_to_order: BOOL("Whether the product is made to order."),
        lead_time_days: INT("Lead time in days (0–3650)."),
        lead_time_label: STR("Human label, e.g. '2–3 weeks'."),
        min_order_quantity: INT("Minimum order quantity (≥ 1)."),
        maker_story: STR("Story about the maker (≤ 5000 chars)."),
      },
      ["id"]
    ),
  },

  // ===== Partner orders (detail + fulfillment) =============================
  {
    name: "get_order",
    description: "Get a single partner order by id.",
    method: "GET",
    path: "/partners/orders/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Order id, e.g. 'order_...'.") }, ["id"]),
  },
  {
    name: "get_order_preview",
    description: "Get the computed preview of an order (totals, items, pending changes).",
    method: "GET",
    path: "/partners/orders/:id/preview",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Order id.") }, ["id"]),
  },
  {
    name: "get_order_line_items",
    description: "List an order's line items.",
    method: "GET",
    path: "/partners/orders/:id/line-items",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Order id.") }, ["id"]),
  },
  {
    name: "get_order_partner_fee",
    description: "Get the partner fee / payout breakdown for an order.",
    method: "GET",
    path: "/partners/orders/:id/partner-fee",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Order id.") }, ["id"]),
  },
  {
    name: "create_order_fulfillment",
    description:
      "Create a fulfillment for an order (pick items to fulfill from a location). Body follows the fulfillment route (items, location_id, …). Sensitive.",
    method: "POST",
    path: "/partners/orders/:id/fulfillments",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["items", "location_id", "no_notification", "metadata"],
    inputSchema: obj(
      {
        id: STR("Order id."),
        items: {
          type: "array",
          description: "Items to fulfill: [{ id | line_item_id, quantity }].",
          items: { type: "object", additionalProperties: true },
        },
        location_id: STR("Stock location to fulfill from."),
        no_notification: BOOL("Suppress the customer notification."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["id"]
    ),
  },
  {
    name: "mark_fulfillment_delivered",
    description: "Mark a fulfillment as delivered. Sensitive.",
    method: "POST",
    path: "/partners/orders/:id/fulfillments/:fulfillmentId/mark-as-delivered",
    pathParams: ["id", "fulfillmentId"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      { id: STR("Order id."), fulfillmentId: STR("Fulfillment id.") },
      ["id", "fulfillmentId"]
    ),
  },
  {
    name: "create_fulfillment_shipment",
    description:
      "Create a shipment for a fulfillment (marks it shipped, optionally with tracking). Body follows the shipment route. Sensitive.",
    method: "POST",
    path: "/partners/orders/:id/fulfillments/:fulfillmentId/shipment",
    pathParams: ["id", "fulfillmentId"],
    write: true,
    sensitive: true,
    bodyParams: ["items", "labels", "tracking_numbers", "no_notification", "metadata"],
    inputSchema: obj(
      {
        id: STR("Order id."),
        fulfillmentId: STR("Fulfillment id."),
        items: { type: "array", description: "Items shipped.", items: { type: "object", additionalProperties: true } },
        labels: { type: "array", description: "Shipping labels.", items: { type: "object", additionalProperties: true } },
        tracking_numbers: { type: "array", description: "Tracking numbers.", items: { type: "string" } },
        no_notification: BOOL("Suppress the customer notification."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "fulfillmentId"]
    ),
  },
]
