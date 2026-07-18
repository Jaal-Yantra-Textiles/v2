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
  /**
   * One-line note about non-obvious effects of running this tool (state it
   * leaves behind, what it does NOT do). Rendered into the model-facing
   * description so the agent reasons about the tool's real footprint — e.g.
   * "creates the product in draft with variants + inventory items; does not
   * publish or set stock quantities."
   */
  sideEffects?: string
  /**
   * Tool names the agent typically calls after this one to complete the task.
   * Rendered into the description as a hint (not enforced). Keep these to real
   * follow-ups a partner would expect — publishing, pricing, stock — not an
   * exhaustive graph. HARD invariants (a managed variant MUST have a stock
   * level) belong in the route, not here.
   */
  nextSteps?: string[]
}

/**
 * Fold the declarative guidance fields (`sideEffects`, `nextSteps`) into a
 * short suffix appended to the model-facing description. Single source of truth
 * so the chat route AND the MCP server render identical guidance. Returns "" when
 * a tool declares neither, so untouched tools are unaffected.
 */
export const renderToolGuidance = (def: PartnerMcpToolDef): string => {
  const parts: string[] = []
  if (def.sideEffects) parts.push(`Side effects: ${def.sideEffects}`)
  if (def.nextSteps?.length) parts.push(`Usually followed by: ${def.nextSteps.join(", ")}.`)
  return parts.length ? `\n${parts.join(" ")}` : ""
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
    sideEffects:
      "creates the product with its variants + inventory items and seeds a 0-quantity stock level at the store location. The product stays a DRAFT and stock stays 0. Publish it with update_store_product (set product.status='published'); stock quantities are set by the partner from the dashboard Products→inventory page (there is no chat tool for stock yet).",
    nextSteps: ["update_store_product"],
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
    // Advise the model about post-create state from the ACTUAL result, so it
    // reports/acts precisely instead of relying on a static rule it may forget.
    transform: (data: any) => {
      const p = data?.product
      if (!p) return data
      const warnings: string[] = []
      if (p.status === "draft") {
        warnings.push(
          "Product is a DRAFT — not visible on the storefront. Publish it with update_store_product (product.status='published') when ready."
        )
      }
      const managedZero = (p.variants || []).filter((v: any) => {
        if (!v?.manage_inventory) return false
        const levels = (v.inventory_items || []).flatMap(
          (ii: any) => ii?.inventory?.location_levels || ii?.location_levels || []
        )
        const stocked = levels.reduce(
          (s: number, l: any) => s + (Number(l?.stocked_quantity) || 0),
          0
        )
        return stocked === 0
      })
      if (managedZero.length) {
        warnings.push(
          `${managedZero.length} variant(s) have 0 stock. There is no chat tool to set stock yet — tell the partner to set quantities on the dashboard Products→inventory page.`
        )
      }
      return warnings.length ? { ...data, _advisory: warnings } : data
    },
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

  // ===== Broader reads (Tier 1): customers, payments, returns/claims/exchanges,
  //   production-run list, inventory detail, currencies & reasons ===============
  {
    name: "list_production_runs",
    description:
      "List the partner's production runs (paginated). Filter by status, role, run_type ('production'|'sample') or design_id.",
    method: "GET",
    path: "/partners/production-runs",
    queryParams: ["limit", "offset", "q", "status", "role", "run_type", "design_id"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional status filter."),
      role: STR("Optional role filter."),
      run_type: { type: "string", enum: ["production", "sample"], description: "Run type filter." },
      design_id: STR("Filter to runs for a specific design."),
    }),
  },
  {
    name: "list_customers",
    description: "List the partner's store customers (paginated). Free-text search via q.",
    method: "GET",
    path: "/partners/customers",
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "get_customer",
    description: "Get a single customer by id.",
    method: "GET",
    path: "/partners/customers/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Customer id, e.g. 'cus_...'.") }, ["id"]),
  },
  {
    name: "list_customer_groups",
    description: "List the partner's customer groups (paginated). Free-text search via q.",
    method: "GET",
    path: "/partners/customer-groups",
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "get_payment",
    description: "Get a single payment by id, with its refunds and refund reasons.",
    method: "GET",
    path: "/partners/payments/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Payment id, e.g. 'pay_...'.") }, ["id"]),
  },
  {
    name: "list_payment_providers",
    description: "List the payment providers available to the partner (optionally only enabled ones).",
    method: "GET",
    path: "/partners/payment-providers",
    queryParams: ["is_enabled"],
    inputSchema: obj({
      is_enabled: STR("Set 'true' to list only enabled providers."),
    }),
  },
  {
    name: "list_payment_submissions",
    description: "List the partner's payout/payment submission records (paginated).",
    method: "GET",
    path: "/partners/payment-submissions",
    queryParams: ["limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "get_payment_submission",
    description: "Get a single payment/payout submission by id.",
    method: "GET",
    path: "/partners/payment-submissions/:submissionId",
    pathParams: ["submissionId"],
    inputSchema: obj(
      { submissionId: STR("Payment submission id.") },
      ["submissionId"]
    ),
  },
  {
    name: "list_returns",
    description: "List returns for the partner's sales channel (optionally filtered by order_id).",
    method: "GET",
    path: "/partners/returns",
    queryParams: ["order_id"],
    inputSchema: obj({
      order_id: STR("Filter to returns for a specific order id."),
    }),
  },
  {
    name: "get_return",
    description: "Get a single return by id, with its items.",
    method: "GET",
    path: "/partners/returns/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Return id.") }, ["id"]),
  },
  {
    name: "list_claims",
    description: "List order claims for the partner's sales channel.",
    method: "GET",
    path: "/partners/claims",
    inputSchema: obj({}),
  },
  {
    name: "get_claim",
    description: "Get a single order claim by id.",
    method: "GET",
    path: "/partners/claims/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Claim id.") }, ["id"]),
  },
  {
    name: "list_exchanges",
    description: "List order exchanges for the partner's sales channel.",
    method: "GET",
    path: "/partners/exchanges",
    inputSchema: obj({}),
  },
  {
    name: "get_exchange",
    description: "Get a single order exchange by id.",
    method: "GET",
    path: "/partners/exchanges/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Exchange id.") }, ["id"]),
  },
  {
    name: "get_inventory_item",
    description: "Get a single inventory item by id.",
    method: "GET",
    path: "/partners/inventory-items/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Inventory item id, e.g. 'iitem_...'.") }, ["id"]),
  },
  {
    name: "list_inventory_levels",
    description: "List stock levels for an inventory item (scoped to the partner's location).",
    method: "GET",
    path: "/partners/inventory-items/:id/levels",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Inventory item id.") }, ["id"]),
  },
  {
    name: "list_raw_materials",
    description:
      "Browse the global raw-material catalog (media, composition, material type) for design BOMs. Free-text search via q.",
    method: "GET",
    path: "/partners/inventory-items/raw-materials",
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "get_partner_details",
    description:
      "Get the partner's extended details (profile + store + onboarding summary). Richer than get_partner_profile when you need the full dashboard context.",
    method: "GET",
    path: "/partners/details",
    inputSchema: obj({}),
  },
  {
    name: "list_currencies",
    description: "List the store's enabled currencies (paginated).",
    method: "GET",
    path: "/partners/currencies",
    queryParams: ["limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "list_refund_reasons",
    description: "List configured refund reasons (for processing refunds). Free-text search via q.",
    method: "GET",
    path: "/partners/refund-reasons",
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "list_return_reasons",
    description: "List configured return reasons (for processing returns). Free-text search via q.",
    method: "GET",
    path: "/partners/return-reasons",
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },

  // ===== Storefront management (Tier 2): status, website, pages, domain ======
  {
    name: "get_storefront_status",
    description:
      "Get the partner's storefront status (provisioned? live? domain, website id, deployment project). Call to check whether the storefront exists before provision/redeploy.",
    method: "GET",
    path: "/partners/storefront",
    inputSchema: obj({}),
  },
  {
    name: "get_storefront_website",
    description:
      "Get the storefront website record (theme, config, blocks). The source of truth the storefront renders from.",
    method: "GET",
    path: "/partners/storefront/website",
    inputSchema: obj({}),
  },
  {
    name: "update_storefront_website",
    description:
      "Create or update the storefront website record (theme policy / website payload). Body follows the website route's validator. Write — persists the website config the storefront renders.",
    method: "POST",
    path: "/partners/storefront/website",
    write: true,
    previewPath: "/partners/storefront/website",
    bodyParams: ["website", "theme", "metadata"],
    inputSchema: obj(
      {
        website: { type: "object", description: "Website fields to upsert.", additionalProperties: true },
        theme: { type: "object", description: "Theme policy payload.", additionalProperties: true },
        metadata: { type: "object", additionalProperties: true },
      }
    ),
  },
  {
    name: "get_storefront_analytics",
    description: "Get storefront analytics (traffic / visits) for the partner's storefront.",
    method: "GET",
    path: "/partners/storefront/website/analytics",
    queryParams: ["start", "end"],
    inputSchema: obj({
      start: STR("Optional ISO start date for the analytics window."),
      end: STR("Optional ISO end date for the analytics window."),
    }),
  },
  {
    name: "update_storefront_analytics",
    description: "Update storefront analytics settings/integration config (e.g. provider keys).",
    method: "PUT",
    path: "/partners/storefront/website/analytics",
    write: true,
    previewPath: "/partners/storefront/website/analytics",
    bodyParams: ["config", "provider", "metadata"],
    inputSchema: obj({
      config: { type: "object", additionalProperties: true },
      provider: STR("Analytics provider id, e.g. 'google' or 'plausible'."),
      metadata: { type: "object", additionalProperties: true },
    }),
  },
  {
    name: "list_storefront_pages",
    description:
      "List the storefront's pages (home, about, product lists, …). Filter by q, status, page_type.",
    method: "GET",
    path: "/partners/storefront/pages",
    queryParams: ["q", "status", "page_type", "limit", "offset"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional page status filter."),
      page_type: STR("Optional page type filter, e.g. 'home', 'product', 'collection'."),
    }),
  },
  {
    name: "get_storefront_page",
    description: "Get a single storefront page by id (with its blocks).",
    method: "GET",
    path: "/partners/storefront/pages/:pageId",
    pathParams: ["pageId"],
    inputSchema: obj({ pageId: STR("Page id.") }, ["pageId"]),
  },
  {
    name: "list_storefront_page_blocks",
    description: "List the content blocks of a storefront page.",
    method: "GET",
    path: "/partners/storefront/pages/:pageId/blocks",
    pathParams: ["pageId"],
    inputSchema: obj({ pageId: STR("Page id.") }, ["pageId"]),
  },
  {
    name: "create_storefront_page",
    description: "Create a storefront page (title, slug, page_type, status). The route validator is the source of truth.",
    method: "POST",
    path: "/partners/storefront/pages",
    write: true,
    bodyParams: ["title", "slug", "page_type", "status", "blocks", "metadata"],
    inputSchema: obj(
      {
        title: STR("Page title."),
        slug: STR("URL slug."),
        page_type: STR("Page type, e.g. 'home'."),
        status: STR("Optional status, e.g. 'published'."),
        blocks: { type: "array", items: { type: "object", additionalProperties: true } },
        metadata: { type: "object", additionalProperties: true },
      },
      ["title"]
    ),
  },
  {
    name: "update_storefront_page",
    description: "Update a storefront page (title, slug, status, blocks). Pass only the fields to change.",
    method: "PUT",
    path: "/partners/storefront/pages/:pageId",
    pathParams: ["pageId"],
    write: true,
    previewPath: "/partners/storefront/pages/:pageId",
    bodyParams: ["title", "slug", "page_type", "status", "blocks", "metadata"],
    inputSchema: obj(
      {
        pageId: STR("Page id to update."),
        title: STR("Page title."),
        slug: STR("URL slug."),
        page_type: STR("Page type."),
        status: STR("Status."),
        blocks: { type: "array", items: { type: "object", additionalProperties: true } },
        metadata: { type: "object", additionalProperties: true },
      },
      ["pageId"]
    ),
  },
  {
    name: "get_storefront_domain",
    description: "Get the storefront's configured custom domain (if any).",
    method: "GET",
    path: "/partners/storefront/domain",
    inputSchema: obj({}),
  },
  {
    name: "update_storefront_domain",
    description:
      "Set or change the storefront's custom domain. Sensitive — affects the live storefront URL; the partner should confirm. Body: { domain }.",
    method: "POST",
    path: "/partners/storefront/domain",
    write: true,
    sensitive: true,
    previewPath: "/partners/storefront/domain",
    bodyParams: ["domain"],
    inputSchema: obj(
      { domain: STR("The custom domain to set, e.g. 'shop.example.com'.") },
      ["domain"]
    ),
  },
  {
    name: "verify_storefront_domain",
    description:
      "Trigger DNS verification for the storefront's custom domain. Sensitive — re-runs verification against the configured domain.",
    method: "POST",
    path: "/partners/storefront/domain/verify",
    write: true,
    sensitive: true,
    inputSchema: obj({}),
  },
  {
    name: "provision_storefront",
    description:
      "Provision the partner's storefront (creates the website, seeds default pages, kicks off deployment). Sensitive — heavy, one-time setup. Run get_storefront_status first to check it isn't already provisioned.",
    method: "POST",
    path: "/partners/storefront/provision",
    write: true,
    sensitive: true,
    previewPath: "/partners/storefront",
    inputSchema: obj({}),
  },
  {
    name: "redeploy_storefront",
    description:
      "Trigger a redeploy of the storefront (rebuild + publish). Sensitive — touches the live site. Use after content/theme changes need to go live.",
    method: "POST",
    path: "/partners/storefront/redeploy",
    write: true,
    sensitive: true,
    previewPath: "/partners/storefront",
    inputSchema: obj({}),
  },
  {
    name: "seed_storefront_pages",
    description:
      "Seed/re-seed the storefront's default pages from the template set. Sensitive — overwrites default pages; confirm with the partner first.",
    method: "POST",
    path: "/partners/storefront/seed-pages",
    write: true,
    sensitive: true,
    inputSchema: obj({}),
  },

  // ===== Store config (Tier 3): /partners/stores/:id setup surface ===========
  // The store id is the :id param from list_stores / create_store. These let the
  // assistant fully configure a store (regions, products, shipping, tax, sales
  // channels, locations) during onboarding.
  {
    name: "get_store",
    description: "Get a single store by id (config, default sales channel, region, location).",
    method: "GET",
    path: "/partners/stores/:id",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Store id, e.g. 'store_...'.") }, ["id"]),
  },
  {
    name: "update_store",
    description:
      "Update a store (name, default_sales_channel_id, metadata, …). Pass only the fields to change.",
    method: "POST",
    path: "/partners/stores/:id",
    pathParams: ["id"],
    write: true,
    previewPath: "/partners/stores/:id",
    bodyParams: ["name", "default_sales_channel_id", "metadata", "supported_currencies"],
    inputSchema: obj(
      {
        id: STR("Store id to update."),
        name: STR("Store display name."),
        default_sales_channel_id: STR("Default sales channel id."),
        supported_currencies: { type: "array", items: { type: "object", additionalProperties: true } },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id"]
    ),
  },
  {
    name: "list_store_regions",
    description: "List a store's regions (currency + countries).",
    method: "GET",
    path: "/partners/stores/:id/regions",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },
  {
    name: "get_store_region",
    description: "Get a single region of a store by id.",
    method: "GET",
    path: "/partners/stores/:id/regions/:regionId",
    pathParams: ["id", "regionId"],
    inputSchema: obj(
      { id: STR("Store id."), regionId: STR("Region id (reg_...).") },
      ["id", "regionId"]
    ),
  },
  {
    name: "add_store_region",
    description:
      "Add a region to a store (name, currency_code, countries, optional payment_providers). Body follows the store-region route validator.",
    method: "POST",
    path: "/partners/stores/:id/regions",
    pathParams: ["id"],
    write: true,
    bodyParams: ["name", "currency_code", "countries", "payment_providers", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        name: STR("Region name, e.g. 'India'."),
        currency_code: STR("3-letter code, e.g. 'inr'."),
        countries: { type: "array", description: "Lower-case ISO-2 codes, e.g. ['in'].", items: { type: "string" } },
        payment_providers: { type: "array", items: { type: "string" } },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "name", "currency_code", "countries"]
    ),
  },
  {
    name: "update_store_region",
    description: "Update a store region (name, currency, countries, providers). Pass only the fields to change.",
    method: "POST",
    path: "/partners/stores/:id/regions/:regionId",
    pathParams: ["id", "regionId"],
    write: true,
    previewPath: "/partners/stores/:id/regions/:regionId",
    bodyParams: ["name", "currency_code", "countries", "payment_providers", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        regionId: STR("Region id to update."),
        name: STR("Region name."),
        currency_code: STR("3-letter code."),
        countries: { type: "array", items: { type: "string" } },
        payment_providers: { type: "array", items: { type: "string" } },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "regionId"]
    ),
  },
  {
    name: "delete_store_region",
    description: "Delete a region from a store. Sensitive (DELETE).",
    method: "DELETE",
    path: "/partners/stores/:id/regions/:regionId",
    pathParams: ["id", "regionId"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      { id: STR("Store id."), regionId: STR("Region id to delete.") },
      ["id", "regionId"]
    ),
  },
  {
    name: "list_store_products",
    description: "List the products configured directly under a store (paginated).",
    method: "GET",
    path: "/partners/stores/:id/products",
    pathParams: ["id"],
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },
  {
    name: "get_store_product",
    description: "Get a single product configured under a store by id.",
    method: "GET",
    path: "/partners/stores/:id/products/:productId",
    pathParams: ["id", "productId"],
    inputSchema: obj(
      { id: STR("Store id."), productId: STR("Product id.") },
      ["id", "productId"]
    ),
  },
  {
    name: "add_store_product",
    description:
      "Add an existing product to a store's product set. Body follows the store-product route validator.",
    method: "POST",
    path: "/partners/stores/:id/products",
    pathParams: ["id"],
    write: true,
    bodyParams: ["product_id", "product", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        product_id: STR("Existing product id to add."),
        product: { type: "object", description: "Optional product overrides.", additionalProperties: true },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id"]
    ),
  },
  {
    name: "update_store_product",
    description: "Update a store-level product config. Pass only the fields to change.",
    method: "POST",
    path: "/partners/stores/:id/products/:productId",
    pathParams: ["id", "productId"],
    write: true,
    previewPath: "/partners/stores/:id/products/:productId",
    bodyParams: ["product", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        productId: STR("Product id to update."),
        product: { type: "object", additionalProperties: true },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "productId"]
    ),
  },
  {
    name: "delete_store_product",
    description: "Remove a product from a store's product set. Sensitive (DELETE).",
    method: "DELETE",
    path: "/partners/stores/:id/products/:productId",
    pathParams: ["id", "productId"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      { id: STR("Store id."), productId: STR("Product id to remove.") },
      ["id", "productId"]
    ),
  },
  {
    name: "list_store_product_variants",
    description: "List the product variants available in a store (paginated).",
    method: "GET",
    path: "/partners/stores/:id/product-variants",
    pathParams: ["id"],
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },
  {
    name: "list_store_shipping_options",
    description: "List the shipping options configured for a store.",
    method: "GET",
    path: "/partners/stores/:id/shipping-options",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },
  {
    name: "add_store_shipping_option",
    description:
      "Add a shipping option to a store (name, provider, price type, amount, …). Body follows the route validator.",
    method: "POST",
    path: "/partners/stores/:id/shipping-options",
    pathParams: ["id"],
    write: true,
    bodyParams: ["name", "provider_id", "price_type", "amount", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        name: STR("Shipping option name."),
        provider_id: STR("Fulfillment provider id."),
        price_type: STR("Price type, e.g. 'flat'."),
        amount: { type: "number", description: "Flat amount (if applicable)." },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "name"]
    ),
  },
  {
    name: "list_store_tax_regions",
    description: "List the tax regions configured for a store.",
    method: "GET",
    path: "/partners/stores/:id/tax-regions",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },
  {
    name: "add_store_tax_region",
    description: "Add a tax region to a store (country_code, rate, …). Body follows the route validator.",
    method: "POST",
    path: "/partners/stores/:id/tax-regions",
    pathParams: ["id"],
    write: true,
    bodyParams: ["country_code", "province_code", "rate", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        country_code: STR("ISO-2 country code, e.g. 'in'."),
        province_code: STR("Optional province/state code."),
        rate: { type: "number", description: "Tax rate (e.g. 0.05 for 5%)." },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "country_code"]
    ),
  },
  {
    name: "list_store_sales_channels",
    description: "List the sales channels of a store.",
    method: "GET",
    path: "/partners/stores/:id/sales-channels",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },
  {
    name: "add_store_sales_channel",
    description: "Add a sales channel to a store. Body follows the route validator.",
    method: "POST",
    path: "/partners/stores/:id/sales-channels",
    pathParams: ["id"],
    write: true,
    bodyParams: ["name", "description", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        name: STR("Sales channel name."),
        description: STR("Optional description."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "name"]
    ),
  },
  {
    name: "list_store_locations",
    description: "List the stock locations linked to a store.",
    method: "GET",
    path: "/partners/stores/:id/locations",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },
  {
    name: "add_store_location",
    description: "Link/create a stock location for a store (name, address). Body follows the route validator.",
    method: "POST",
    path: "/partners/stores/:id/locations",
    pathParams: ["id"],
    write: true,
    bodyParams: ["name", "address", "metadata"],
    inputSchema: obj(
      {
        id: STR("Store id."),
        name: STR("Location / warehouse name."),
        address: { type: "object", description: "Address payload.", additionalProperties: true },
        metadata: { type: "object", additionalProperties: true },
      },
      ["id", "name"]
    ),
  },
  {
    name: "list_store_payment_providers",
    description: "List the payment providers enabled for a store's regions.",
    method: "GET",
    path: "/partners/stores/:id/payment-providers",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Store id.") }, ["id"]),
  },

  // ===== Sensitive mutations + order/payment edits (Tier 4) ===================
  // These touch live orders/payments. High-stakes ones are flagged `sensitive`
  // → the dispatcher returns `requires_confirmation` so the chat surfaces an
  // approval card rather than acting unilaterally.
  {
    name: "list_order_changes",
    description: "List the pending order changes (edits/fulfillment/returns) for an order.",
    method: "GET",
    path: "/partners/orders/:id/changes",
    pathParams: ["id"],
    inputSchema: obj({ id: STR("Order id.") }, ["id"]),
  },
  {
    name: "get_fulfillment_tracking",
    description: "Get tracking numbers/links for an order's fulfillment.",
    method: "GET",
    path: "/partners/orders/:id/fulfillments/:fulfillmentId/tracking",
    pathParams: ["id", "fulfillmentId"],
    inputSchema: obj(
      { id: STR("Order id."), fulfillmentId: STR("Fulfillment id.") },
      ["id", "fulfillmentId"]
    ),
  },
  {
    name: "list_assigned_tasks",
    description: "List the tasks assigned to the partner (paginated).",
    method: "GET",
    path: "/partners/assigned-tasks",
    queryParams: ["limit", "offset", "status"],
    inputSchema: obj({ ...PAGINATION, status: STR("Optional status filter.") }),
  },
  {
    name: "get_assigned_task",
    description: "Get a single assigned task by id (with subtasks + comments).",
    method: "GET",
    path: "/partners/assigned-tasks/:taskId",
    pathParams: ["taskId"],
    inputSchema: obj({ taskId: STR("Task id.") }, ["taskId"]),
  },
  {
    name: "cancel_order",
    description:
      "Cancel a partner order. Sensitive — the order stops being fulfillable. Confirm with the partner first.",
    method: "POST",
    path: "/partners/orders/:id/cancel",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    previewPath: "/partners/orders/:id",
    inputSchema: obj({ id: STR("Order id to cancel.") }, ["id"]),
  },
  {
    name: "transfer_order",
    description:
      "Transfer an order's fulfillment to another location/partner. Sensitive — affects who fulfills the order. Body follows the route (e.g. location_id).",
    method: "POST",
    path: "/partners/orders/:id/transfer",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    previewPath: "/partners/orders/:id",
    bodyParams: ["location_id", "metadata"],
    inputSchema: obj(
      {
        id: STR("Order id to transfer."),
        location_id: STR("Destination stock location id."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["id"]
    ),
  },
  {
    name: "cancel_fulfillment",
    description:
      "Cancel a fulfillment (un-ship it). Sensitive — reverses a shipment. Confirm with the partner first.",
    method: "POST",
    path: "/partners/orders/:id/fulfillments/:fulfillmentId/cancel",
    pathParams: ["id", "fulfillmentId"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      { id: STR("Order id."), fulfillmentId: STR("Fulfillment id to cancel.") },
      ["id", "fulfillmentId"]
    ),
  },
  {
    name: "capture_payment",
    description:
      "Capture an authorized payment. Sensitive — moves money. Confirm with the partner first. Optional body: { amount } for partial capture.",
    method: "POST",
    path: "/partners/payments/:id/capture",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["amount"],
    inputSchema: obj(
      { id: STR("Payment id, e.g. 'pay_...'."), amount: { type: "number", description: "Optional partial capture amount." } },
      ["id"]
    ),
  },
  {
    name: "refund_payment",
    description:
      "Refund a payment (full or partial). Sensitive — returns money to the customer. Body follows the refund workflow (amount, reason_id, note, …).",
    method: "POST",
    path: "/partners/payments/:id/refund",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    bodyParams: ["amount", "reason_id", "note", "metadata"],
    inputSchema: obj(
      {
        id: STR("Payment id to refund."),
        amount: { type: "number", description: "Refund amount." },
        reason_id: STR("Refund reason id (from list_refund_reasons)."),
        note: STR("Optional internal note."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["id"]
    ),
  },
  {
    name: "mark_payment_collection_paid",
    description:
      "Mark a payment collection as paid (manual/offline payment). Sensitive — affects order/payment accounting.",
    method: "POST",
    path: "/partners/payment-collections/:id/mark-as-paid",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Payment collection id (paycol_...).") }, ["id"]),
  },
  {
    name: "request_order_edit",
    description:
      "Begin an order edit (request changes to items/quantities/prices). Body follows the order-edit route (order_id, …). Write — opens the edit, doesn't apply it yet.",
    method: "POST",
    path: "/partners/order-edits",
    write: true,
    bodyParams: ["order_id", "metadata"],
    inputSchema: obj(
      {
        order_id: STR("Order id to edit."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["order_id"]
    ),
  },
  {
    name: "confirm_order_edit",
    description:
      "Confirm/apply a pending order edit (applies the staged changes to the order). Sensitive — mutates the live order.",
    method: "POST",
    path: "/partners/order-edits/:id/confirm",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj({ id: STR("Order edit id to confirm.") }, ["id"]),
  },
  {
    name: "accept_task",
    description:
      "Accept a task assigned to the partner. Sensitive — commits the partner to the work.",
    method: "POST",
    path: "/partners/tasks/:taskId/accept",
    pathParams: ["taskId"],
    write: true,
    sensitive: true,
    inputSchema: obj({ taskId: STR("Task id to accept.") }, ["taskId"]),
  },
  {
    name: "finish_task",
    description: "Mark an accepted task as finished.",
    method: "POST",
    path: "/partners/tasks/:taskId/finish",
    pathParams: ["taskId"],
    write: true,
    inputSchema: obj({ taskId: STR("Task id to finish.") }, ["taskId"]),
  },

  // ===== Platform discovery + AI (Tier 5) ====================================
  // Discovery = browsing products across OTHER partners' sales channels so a
  // partner can copy a product template into their own store. AI = read-only
  // usage stats + a vision describe tool.
  {
    name: "discover_products",
    description:
      "Browse products across OTHER partners' sales channels (platform discovery). Use to find product templates the partner can copy into their own store. Paginated, free-text search via q.",
    method: "GET",
    path: "/partners/discover/products",
    queryParams: ["q", "limit", "offset"],
    inputSchema: obj({ ...PAGINATION }),
  },
  {
    name: "copy_discover_product",
    description:
      "Deep-copy a discovered product into the partner's own store/sales channel. Sensitive — creates products in the partner's catalog from a source product. Pass the source product id from discover_products.",
    method: "POST",
    path: "/partners/discover/products/:id/copy",
    pathParams: ["id"],
    write: true,
    sensitive: true,
    inputSchema: obj(
      { id: STR("Source product id to copy (from discover_products).") },
      ["id"]
    ),
  },
  {
    name: "get_ai_usage",
    description: "Get the partner's AI feature usage stats (tokens, calls, cost) for the billing period.",
    method: "GET",
    path: "/partners/ai/usage",
    queryParams: ["start", "end"],
    inputSchema: obj({
      start: STR("Optional ISO start date."),
      end: STR("Optional ISO end date."),
    }),
  },
  {
    name: "describe_image",
    description:
      "Run vision AI on an image URL to get a structured description (garment/material attributes) — useful before creating a design or product from a photo. Body: { imageUrl, hint? }.",
    method: "POST",
    path: "/partners/ai/describe-image",
    write: true,
    bodyParams: ["imageUrl", "hint"],
    inputSchema: obj(
      {
        imageUrl: STR("Public URL of the image to describe."),
        hint: STR("Optional hint, e.g. 'describe the weave and color'."),
      },
      ["imageUrl"]
    ),
  },

  // ===== Inventory orders (Tier 6) — raw-material purchase orders ============
  // The partner's own purchase orders for raw materials / inventory. Lifecycle:
  //   list → get → start → (submit-payment) → shiprocket-rates / ready-for-delivery
  //   → shipment → complete
  {
    name: "list_inventory_orders",
    description:
      "List the partner's inventory (purchase) orders — raw-material purchases from suppliers. Paginated, free-text search via q, optional status filter.",
    method: "GET",
    path: "/partners/inventory-orders",
    queryParams: ["limit", "offset", "q", "status"],
    inputSchema: obj({
      ...PAGINATION,
      status: STR("Optional status filter."),
    }),
  },
  {
    name: "get_inventory_order",
    description: "Get a single inventory (purchase) order by id, with its lines and supplier.",
    method: "GET",
    path: "/partners/inventory-orders/:orderId",
    pathParams: ["orderId"],
    inputSchema: obj({ orderId: STR("Inventory order id.") }, ["orderId"]),
  },
  {
    name: "start_inventory_order",
    description:
      "Start an inventory (purchase) order — moves it from draft/placed into in-progress (supplier is making/shipping). Body follows the route validator.",
    method: "POST",
    path: "/partners/inventory-orders/:orderId/start",
    pathParams: ["orderId"],
    write: true,
    previewPath: "/partners/inventory-orders/:orderId",
    bodyParams: ["metadata"],
    inputSchema: obj(
      {
        orderId: STR("Inventory order id to start."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["orderId"]
    ),
  },
  {
    name: "submit_inventory_order_payment",
    description:
      "Record a payment made to a supplier for an inventory order (Bank/Cash/Digital_Wallet), with optional receipts. Sensitive — moves/reconciles money. Supports an idempotency_key for safe retries.",
    method: "POST",
    path: "/partners/inventory-orders/:orderId/submit-payment",
    pathParams: ["orderId"],
    write: true,
    sensitive: true,
    previewPath: "/partners/inventory-orders/:orderId",
    bodyParams: [
      "amount", "payment_type", "payment_date", "note",
      "paid_to_id", "attachments", "idempotency_key",
    ],
    inputSchema: obj(
      {
        orderId: STR("Inventory order id."),
        amount: { type: "number", description: "Amount paid (> 0). Required." },
        payment_type: {
          type: "string",
          enum: ["Bank", "Cash", "Digital_Wallet"],
          description: "How the supplier was paid.",
        },
        payment_date: STR("ISO date the payment was made."),
        note: STR("Optional note."),
        paid_to_id: STR("Optional recipient id."),
        attachments: { type: "array", description: "Receipt/invoice file attachments.", items: { type: "object", additionalProperties: true } },
        idempotency_key: STR("Optional idempotency key to dedupe retries."),
      },
      ["orderId", "amount"]
    ),
  },
  {
    name: "get_inventory_order_shiprocket_rates",
    description:
      "Get live Shiprocket shipping rates/quotes for an inventory order (carrier options + cost). Read.",
    method: "GET",
    path: "/partners/inventory-orders/:orderId/shiprocket-rates",
    pathParams: ["orderId"],
    inputSchema: obj({ orderId: STR("Inventory order id.") }, ["orderId"]),
  },
  {
    name: "get_inventory_order_fulfillment_rates",
    description:
      "Alias for get_inventory_order_shiprocket_rates (fulfillment-rate quotes). Read.",
    method: "GET",
    path: "/partners/inventory-orders/:orderId/fulfillment-rates",
    pathParams: ["orderId"],
    inputSchema: obj({ orderId: STR("Inventory order id.") }, ["orderId"]),
  },
  {
    name: "ready_inventory_order_for_delivery",
    description:
      "Mark an inventory order ready for delivery / pickup. Sensitive — changes the order's fulfillment state. Body follows the route validator.",
    method: "POST",
    path: "/partners/inventory-orders/:orderId/ready-for-delivery",
    pathParams: ["orderId"],
    write: true,
    sensitive: true,
    previewPath: "/partners/inventory-orders/:orderId",
    bodyParams: ["metadata"],
    inputSchema: obj(
      {
        orderId: STR("Inventory order id."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["orderId"]
    ),
  },
  {
    name: "create_inventory_order_shipment",
    description:
      "Create a shipment for an inventory order (book the carrier, optionally set pickup location/weight/dimensions/delivered quantities). Body follows the shipment route. Sensitive — books shipping and changes fulfillment state.",
    method: "POST",
    path: "/partners/inventory-orders/:orderId/shipment",
    pathParams: ["orderId"],
    write: true,
    sensitive: true,
    previewPath: "/partners/inventory-orders/:orderId",
    bodyParams: [
      "carrier", "pickup_stock_location_id", "weight_grams",
      "dimensions_cm", "preferred_courier_id", "delivered_quantities", "pickup_date",
    ],
    inputSchema: obj(
      {
        orderId: STR("Inventory order id to ship."),
        carrier: STR("Optional carrier override."),
        pickup_stock_location_id: STR("Stock location to pick up from."),
        weight_grams: { type: "number", description: "Shipment weight in grams." },
        dimensions_cm: {
          type: "object",
          description: "Optional { length, breadth, height } in cm.",
          additionalProperties: true,
        },
        preferred_courier_id: STR("Optional preferred courier id."),
        delivered_quantities: { type: "object", description: "Map of line id -> delivered qty.", additionalProperties: true },
        pickup_date: STR("Requested pickup date (YYYY-MM-DD)."),
      },
      ["orderId"]
    ),
  },
  {
    name: "complete_inventory_order",
    description:
      "Complete an inventory (purchase) order — final state, goods received. Sensitive — closes out the order. Body follows the route validator.",
    method: "POST",
    path: "/partners/inventory-orders/:orderId/complete",
    pathParams: ["orderId"],
    write: true,
    sensitive: true,
    previewPath: "/partners/inventory-orders/:orderId",
    bodyParams: ["metadata"],
    inputSchema: obj(
      {
        orderId: STR("Inventory order id to complete."),
        metadata: { type: "object", additionalProperties: true },
      },
      ["orderId"]
    ),
  },
]
