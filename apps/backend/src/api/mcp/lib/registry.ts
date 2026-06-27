/**
 * Declarative registry of the Store API endpoints exposed as MCP tools.
 *
 * Each entry maps one MCP tool -> one Medusa Store route. The MCP server is a
 * thin loopback proxy (see proxy.ts): it forwards the tool arguments to the
 * real `/store/*` route, so every tool inherits Medusa's pricing/tax context,
 * query-config defaults, sales-channel scoping, and our custom route overrides
 * (e.g. the /store/products index-engine bugfix) for free.
 *
 * Input schemas are plain JSON Schema (not zod) on purpose: they are returned
 * verbatim to MCP clients in `tools/list`, and they keep this module decoupled
 * from the project's zod version vs the bundled SDK zod.
 *
 * To wrap a new store endpoint, add a row here — no other code changes needed.
 */

export type McpToolDef = {
  /** Tool name surfaced to the agent (snake_case). */
  name: string
  /** One-line description shown in `tools/list`. */
  description: string
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, any>
  /**
   * Native tools run in-process against the container (store discovery / key
   * resolution) instead of proxying to a /store/* route. Proxy tools leave this
   * unset and use method/path below.
   */
  native?: "list_stores" | "get_storefront_key"
  /**
   * HTTP method of the wrapped store route. GET = read tool (always exposed).
   * POST/DELETE = write tool (cart/checkout), gated behind STORE_MCP_ENABLE_WRITE.
   */
  method?: "GET" | "POST" | "DELETE"
  /** Store route path, with `:param` placeholders, e.g. `/store/products/:id`. */
  path?: string
  /** Names of `:param` placeholders that must be supplied as arguments. */
  pathParams?: string[]
  /** Argument keys forwarded to the route as query-string params. */
  queryParams?: string[]
  /**
   * Argument keys assembled into the JSON request body (write tools only).
   * The store route's own validator is the source of truth, so the MCP schema
   * stays permissive — see proxy.ts.
   */
  bodyParams?: string[]
  /**
   * Mutating tool: hidden from `tools/list` and rejected by `tools/call` unless
   * STORE_MCP_ENABLE_WRITE is set. Read tools omit this.
   */
  write?: boolean
  /**
   * Optional post-processor applied to a successful proxy response before it is
   * returned to the agent. Used to normalize provider-specific payloads into an
   * actionable shape (e.g. the payment `next_action`). Must be pure.
   */
  transform?: (data: any, args: Record<string, unknown>) => any
}

/**
 * Normalize an initialized payment session into the concrete next step the
 * client must take, per provider:
 *  - PayU (INR): a redirect form — POST the signed fields to PayU's hosted page
 *    (this resolves the "payment link"); finish with payu_complete_payment.
 *  - Stripe: the client_secret to collect/confirm the card client-side, then
 *    complete_cart.
 *  - anything else (manual / system): the session is ready; complete_cart once
 *    authorized.
 */
export const paymentNextAction = (session: any): Record<string, any> => {
  const providerId: string = session?.provider_id || ""
  const d: Record<string, any> = session?.data || {}

  if (providerId.includes("payu")) {
    return {
      type: "redirect_form",
      provider: "payu",
      provider_id: providerId,
      description:
        "POST these fields as application/x-www-form-urlencoded to `url` to open PayU's hosted checkout (card/UPI/netbanking). Add your own surl/furl (success/failure return URLs). PayU redirects back signed; finish the order with payu_complete_payment.",
      method: "POST",
      url: d.payment_url ?? null,
      fields: {
        key: d.key ?? null,
        txnid: d.txnid ?? null,
        amount: d.amount ?? null,
        productinfo: d.productinfo ?? null,
        firstname: d.firstname ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        udf1: d.udf1 ?? null,
        hash: d.hash ?? null,
      },
      txnid: d.txnid ?? null,
      // If a UPI intent was already generated (payu_generate_upi_intent), surface it.
      upi_link: d.upi_intent_uri ?? null,
      upi_hint: "For UPI, call payu_generate_upi_intent to get a upi://pay deep link + QR.",
    }
  }

  if (providerId.includes("stripe")) {
    return {
      type: "client_secret",
      provider: "stripe",
      provider_id: providerId,
      description:
        "Hand this client_secret to Stripe.js / PaymentSheet on the client to collect and confirm the card, then call complete_cart.",
      client_secret: d.client_secret ?? null,
    }
  }

  return {
    type: "session_ready",
    provider_id: providerId || null,
    description:
      "Payment session initialized. Once the payment is authorized, call complete_cart.",
  }
}

/** Find the just-initialized session (by provider_id) on a payment collection. */
export const pickSession = (data: any, providerId: unknown): any => {
  const sessions = data?.payment_collection?.payment_sessions || []
  const pid = typeof providerId === "string" ? providerId : ""
  return (
    sessions.find((s: any) => s?.provider_id === pid) ||
    sessions.find((s: any) => pid && String(s?.provider_id || "").includes(pid)) ||
    sessions[sessions.length - 1] ||
    null
  )
}

const PAGINATION_PROPS = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 20,
    description: "Max results to return.",
  },
  offset: {
    type: "integer",
    minimum: 0,
    default: 0,
    description: "Number of results to skip (pagination).",
  },
} as const

const STORE_PROP = {
  store: {
    type: "string",
    description:
      "Storefront to scope to: a partner handle/subdomain (e.g. 'acme') or its domain, or 'default'/the apex domain for the platform core store (cicilabel.com). Resolved server-side to that store's default publishable key. Use list_stores to discover. If omitted, falls back to the x-publishable-api-key header or the server default key.",
  },
} as const

const PRICING_PROPS = {
  region_id: {
    type: "string",
    description: "Region id for price/tax context (reg_...).",
  },
  country_code: {
    type: "string",
    description: "Two-letter country code for price/tax context, e.g. 'in'.",
  },
} as const

const FIELDS_PROP = {
  fields: {
    type: "string",
    description:
      "Comma-separated field selector, e.g. 'id,title,handle'. Prefix with '+'/'*' to add relations; omit price fields to skip pricing context.",
  },
} as const

const Q_PROP = {
  q: { type: "string", description: "Full-text search term." },
} as const

/** Builder for a sales-channel-scoped list endpoint. */
const listTool = (
  name: string,
  description: string,
  path: string,
  opts: { searchable?: boolean; query?: string[]; props?: Record<string, any> } = {}
): McpToolDef => ({
  name,
  description,
  method: "GET",
  path,
  queryParams: [
    ...(opts.searchable ? ["q"] : []),
    ...(opts.query ?? []),
    "fields",
    "limit",
    "offset",
  ],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...(opts.searchable ? Q_PROP : {}),
      ...(opts.props ?? {}),
      ...FIELDS_PROP,
      ...STORE_PROP,
      ...PAGINATION_PROPS,
    },
  },
})

/** Builder for a retrieve-by-id endpoint (`/path/:id`). */
const getTool = (
  name: string,
  description: string,
  path: string,
  opts: { query?: string[]; props?: Record<string, any> } = {}
): McpToolDef => ({
  name,
  description,
  method: "GET",
  path,
  pathParams: ["id"],
  queryParams: [...(opts.query ?? []), "fields"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string", description: "Resource id." },
      ...(opts.props ?? {}),
      ...FIELDS_PROP,
      ...STORE_PROP,
    },
  },
})

// --- Write-tool helpers -----------------------------------------------
// A cart/billing/shipping address. Mirrors Medusa's StoreAddAddress — kept
// loose (all optional) so the store route's validator stays the source of truth.
const ADDRESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    first_name: { type: "string" },
    last_name: { type: "string" },
    phone: { type: "string" },
    company: { type: "string" },
    address_1: { type: "string" },
    address_2: { type: "string" },
    city: { type: "string" },
    country_code: {
      type: "string",
      description: "Two-letter ISO country code, e.g. 'in'.",
    },
    province: { type: "string" },
    postal_code: { type: "string" },
  },
} as const

const LINE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["variant_id", "quantity"],
  properties: {
    variant_id: { type: "string", description: "Product variant id (variant_...)." },
    quantity: { type: "integer", minimum: 1, description: "Quantity to add." },
  },
} as const

/**
 * The cart -> checkout -> pay write tools. Every tool here is `write: true`, so
 * it is hidden/blocked unless STORE_MCP_ENABLE_WRITE is set. Typical agent flow:
 *
 *   create_cart -> add_line_item* -> update_cart (email + addresses)
 *   -> list_shipping_options -> add_shipping_method
 *   -> list_payment_providers -> create_payment_collection
 *   -> initialize_payment_session -> complete_cart (=> order)
 */
const CHECKOUT_WRITE_TOOLS: McpToolDef[] = [
  {
    name: "create_cart",
    description:
      "Create a cart in the storefront's sales channel. Optionally seed it with region, email, addresses, line items, and promo codes. Returns the cart (use cart.id for subsequent tools).",
    write: true,
    method: "POST",
    path: "/store/carts",
    bodyParams: [
      "region_id",
      "email",
      "currency_code",
      "items",
      "shipping_address",
      "billing_address",
      "promo_codes",
      "metadata",
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        region_id: { type: "string", description: "Region id (reg_...). Defaults to the store's default region." },
        email: { type: "string", description: "Customer email for the cart." },
        currency_code: { type: "string", description: "Currency code; defaults to the region currency." },
        items: { type: "array", items: LINE_ITEM_SCHEMA, description: "Initial line items." },
        shipping_address: ADDRESS_SCHEMA,
        billing_address: ADDRESS_SCHEMA,
        promo_codes: { type: "array", items: { type: "string" }, description: "Promotion codes to apply." },
        metadata: { type: "object", additionalProperties: true, description: "Custom key-value data." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "get_cart",
    description: "Retrieve a cart by id, including line items, totals, and the chosen shipping/payment state.",
    write: true,
    method: "GET",
    path: "/store/carts/:id",
    pathParams: ["id"],
    queryParams: ["fields"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        ...FIELDS_PROP,
        ...STORE_PROP,
      },
    },
  },
  {
    name: "update_cart",
    description:
      "Update a cart's email, region, addresses, or promo codes. Use this to set the customer email and shipping/billing address before checkout.",
    write: true,
    method: "POST",
    path: "/store/carts/:id",
    pathParams: ["id"],
    bodyParams: ["region_id", "email", "shipping_address", "billing_address", "promo_codes", "metadata"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        region_id: { type: "string", description: "Region id (reg_...)." },
        email: { type: "string", description: "Customer email." },
        shipping_address: ADDRESS_SCHEMA,
        billing_address: ADDRESS_SCHEMA,
        promo_codes: { type: "array", items: { type: "string" }, description: "Promotion codes (replaces existing)." },
        metadata: { type: "object", additionalProperties: true },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "add_line_item",
    description: "Add a product variant to a cart. Returns the updated cart.",
    write: true,
    method: "POST",
    path: "/store/carts/:id/line-items",
    pathParams: ["id"],
    bodyParams: ["variant_id", "quantity", "metadata"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "variant_id", "quantity"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        variant_id: { type: "string", description: "Product variant id (variant_...)." },
        quantity: { type: "integer", minimum: 1, description: "Quantity to add." },
        metadata: { type: "object", additionalProperties: true },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "update_line_item",
    description: "Change the quantity of an existing cart line item. Returns the updated cart.",
    write: true,
    method: "POST",
    path: "/store/carts/:id/line-items/:line_id",
    pathParams: ["id", "line_id"],
    bodyParams: ["quantity", "metadata"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "line_id", "quantity"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        line_id: { type: "string", description: "Line item id (item_...)." },
        quantity: { type: "integer", minimum: 1, description: "New quantity." },
        metadata: { type: "object", additionalProperties: true },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "remove_line_item",
    description: "Remove a line item from a cart. Returns the deletion result.",
    write: true,
    method: "DELETE",
    path: "/store/carts/:id/line-items/:line_id",
    pathParams: ["id", "line_id"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "line_id"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        line_id: { type: "string", description: "Line item id (item_...)." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "add_promotion",
    description: "Apply one or more promotion codes to a cart. Returns the updated cart.",
    write: true,
    method: "POST",
    path: "/store/carts/:id/promotions",
    pathParams: ["id"],
    bodyParams: ["promo_codes"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "promo_codes"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        promo_codes: { type: "array", items: { type: "string" }, description: "Promotion codes to apply." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "list_shipping_options",
    description:
      "List the shipping options available for a cart (call after the cart has a shipping address). Use a returned option id with add_shipping_method.",
    write: true,
    method: "GET",
    path: "/store/shipping-options",
    queryParams: ["cart_id", "fields"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["cart_id"],
      properties: {
        cart_id: { type: "string", description: "Cart id (cart_...) to price options for." },
        ...FIELDS_PROP,
        ...STORE_PROP,
      },
    },
  },
  {
    name: "add_shipping_method",
    description: "Select a shipping option for a cart. Returns the updated cart with the shipping method and totals.",
    write: true,
    method: "POST",
    path: "/store/carts/:id/shipping-methods",
    pathParams: ["id"],
    bodyParams: ["option_id", "data"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "option_id"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        option_id: { type: "string", description: "Shipping option id (so_...) from list_shipping_options." },
        data: { type: "object", additionalProperties: true, description: "Optional fulfillment-provider data." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "list_payment_providers",
    description: "List the payment providers enabled for a region. Use a returned provider id with initialize_payment_session.",
    write: true,
    method: "GET",
    path: "/store/payment-providers",
    queryParams: ["region_id", "fields", "limit", "offset"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["region_id"],
      properties: {
        region_id: { type: "string", description: "Region id (reg_...) — the cart's region." },
        ...FIELDS_PROP,
        ...STORE_PROP,
      },
    },
  },
  {
    name: "create_payment_collection",
    description: "Create a payment collection for a cart (the container for its payment sessions). Returns the payment collection.",
    write: true,
    method: "POST",
    path: "/store/payment-collections",
    bodyParams: ["cart_id"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["cart_id"],
      properties: {
        cart_id: { type: "string", description: "Cart id (cart_...)." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "initialize_payment_session",
    description:
      "Initialize a payment session for the chosen provider ('pp_system_default', a Stripe provider, or 'pp_payu_payu' for INR) and resolve the concrete next step. Returns { next_action, payment_collection }: for PayU, next_action is a redirect_form with the hosted payment link (url) + signed fields; for Stripe, a client_secret to collect the card client-side; otherwise session_ready (call complete_cart). For PayU, finish with payu_complete_payment after the redirect.",
    write: true,
    method: "POST",
    path: "/store/payment-collections/:id/payment-sessions",
    pathParams: ["id"],
    bodyParams: ["provider_id", "data"],
    transform: (data, args) => ({
      next_action: paymentNextAction(pickSession(data, args.provider_id)),
      payment_collection: data?.payment_collection ?? data,
    }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "provider_id"],
      properties: {
        id: { type: "string", description: "Payment collection id (paycol_...)." },
        provider_id: { type: "string", description: "Payment provider id from list_payment_providers." },
        data: { type: "object", additionalProperties: true, description: "Optional provider-specific data." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "complete_cart",
    description:
      "Complete a cart and place the order. Run this last, after a payment session is initialized. Returns { type: 'order', order } on success or { type: 'cart', cart, error } if completion failed. NOTE: for PayU/INR (provider pp_payu_payu) use payu_complete_payment instead — PayU needs its redirect-callback data before the cart can complete.",
    write: true,
    method: "POST",
    path: "/store/carts/:id/complete",
    pathParams: ["id"],
    bodyParams: ["idempotency_key"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Cart id (cart_...)." },
        idempotency_key: { type: "string", description: "Optional key to make completion idempotent on retry." },
        ...STORE_PROP,
      },
    },
  },
  // --- PayU (INR) — redirect-gateway completion -------------------------
  // PayU is a redirect/hash gateway: initialize_payment_session(provider_id
  // "pp_payu_payu") returns session data with { payment_url, key, txnid, hash,
  // amount, ... } that a BROWSER posts to PayU's hosted page. The shopper pays
  // there (card/UPI/netbanking) and PayU redirects back with a signed callback.
  // These two tools finish that flow once the callback fields are known.
  {
    name: "payu_complete_payment",
    description:
      "Finish a PayU (INR) checkout after the shopper returns from PayU's hosted page. Updates the PayU payment session with the redirect-callback fields and completes the cart. Returns { type: 'order', order_id } on success, or { type: 'cart', error } (collection auto-refreshed for retry) on failure. Use INSTEAD of complete_cart for pp_payu_payu sessions.",
    write: true,
    method: "POST",
    path: "/store/payu/complete",
    bodyParams: ["cart_id", "payu_status", "mihpayid", "txnid", "hash", "amount"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["cart_id"],
      properties: {
        cart_id: { type: "string", description: "Cart id (cart_...) being completed." },
        payu_status: { type: "string", description: "PayU's status from the callback ('success' or a failure value). Non-success just refreshes the collection for retry." },
        mihpayid: { type: "string", description: "PayU's gateway payment id from the callback." },
        txnid: { type: "string", description: "The merchant transaction id used to initiate (from the session data)." },
        hash: { type: "string", description: "PayU's response hash for verification." },
        amount: { type: "string", description: "Amount reported by PayU in the callback." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "create_payment_link",
    description:
      "Create a shareable PayU payment link (INR) whose checkout offers UPI + cards. Pass cart_id to bill a cart's total (and, once paid, the PayU webhook completes the cart into an order automatically), or pass amount + customer for a standalone link. Returns { type:'payment_link', payment_link, invoice_number }. Requires PayU OneAPI env (PAYU_CLIENT_ID/SECRET/MERCHANT_ID).",
    write: true,
    method: "POST",
    path: "/store/payu/payment-link",
    bodyParams: [
      "cart_id",
      "amount",
      "description",
      "customer",
      "invoice_number",
      "is_partial_payment_allowed",
      "success_url",
      "failure_url",
      "expiry_date",
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cart_id: { type: "string", description: "Cart to bill (derives amount + customer; paid link auto-completes the order via webhook)." },
        amount: { type: "number", description: "Amount in INR (major units). Required if no cart_id." },
        description: { type: "string", description: "Link description shown to the payer." },
        customer: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            mobileNumber: { type: "string" },
          },
        },
        invoice_number: { type: "string", description: "Optional unique invoice id (≤16 chars; auto-generated otherwise)." },
        is_partial_payment_allowed: { type: "boolean" },
        success_url: { type: "string" },
        failure_url: { type: "string" },
        expiry_date: { type: "string", description: "Optional ISO expiry timestamp." },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "payu_generate_upi_intent",
    description:
      "Generate a UPI Intent (a upi://pay deep link the customer taps in any UPI app) for a cart that already has an initialized PayU session (run create_payment_collection → initialize_payment_session with provider_id 'pp_payu_payu' first). Returns { type:'upi_intent', upi_link, qr_url, txnid }. The order completes via the PayU webhook / payu_complete_payment.",
    write: true,
    method: "POST",
    path: "/store/payu/intent",
    bodyParams: ["cart_id", "upi_app", "return_url_base"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["cart_id"],
      properties: {
        cart_id: { type: "string", description: "Cart id (cart_...) with an initialized pp_payu_payu session." },
        upi_app: {
          type: "string",
          description: "Optional UPI app hint: 'phonepe', 'googlepay', 'paytm', or 'genericintent' (default).",
        },
        return_url_base: {
          type: "string",
          description: "Optional storefront origin for success/failure return URLs (defaults to the owning store's domain).",
        },
        ...STORE_PROP,
      },
    },
  },
  {
    name: "payu_refresh_payment",
    description:
      "Reset a cart's PayU payment collection — deletes stale payment sessions so a fresh PayU session (new txnid + hash) can be initialized for a retry. Use after a failed/abandoned PayU attempt before initializing a new session.",
    write: true,
    method: "POST",
    path: "/store/payu/refresh",
    bodyParams: ["cart_id"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["cart_id"],
      properties: {
        cart_id: { type: "string", description: "Cart id (cart_...) to refresh." },
        ...STORE_PROP,
      },
    },
  },
]

export const STORE_MCP_TOOLS: McpToolDef[] = [
  {
    name: "list_products",
    description:
      "List published storefront products in the active sales channel. Supports full-text search and filtering by category/collection/handle.",
    method: "GET",
    path: "/store/products",
    queryParams: [
      "q",
      "handle",
      "category_id",
      "collection_id",
      "tag_id",
      "type_id",
      "region_id",
      "country_code",
      "fields",
      "limit",
      "offset",
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string", description: "Full-text search term." },
        handle: { type: "string", description: "Filter by exact product handle." },
        category_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter to products in these category ids (pcat_...).",
        },
        collection_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter to products in these collection ids (pcol_...).",
        },
        tag_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter by product tag ids.",
        },
        type_id: {
          type: "array",
          items: { type: "string" },
          description: "Filter by product type ids.",
        },
        fields: {
          type: "string",
          description:
            "Comma-separated field selector, e.g. 'id,title,handle,thumbnail'. Omit price fields to skip pricing context.",
        },
        ...STORE_PROP,
        ...PRICING_PROPS,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: "get_product",
    description:
      "Retrieve a single storefront product by id, including variants. Pass region_id or country_code to get calculated prices.",
    method: "GET",
    path: "/store/products/:id",
    pathParams: ["id"],
    queryParams: ["region_id", "country_code", "fields"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Product id (prod_...)." },
        fields: {
          type: "string",
          description:
            "Comma-separated field selector, e.g. 'id,title,handle,thumbnail'. Omit price fields to skip pricing context.",
        },
        ...STORE_PROP,
        ...PRICING_PROPS,
      },
    },
  },
  // --- Built-in catalog -------------------------------------------------
  listTool(
    "list_collections",
    "List product collections in the active sales channel.",
    "/store/collections",
    { searchable: true, query: ["handle"], props: { handle: { type: "string", description: "Filter by exact collection handle." } } }
  ),
  getTool(
    "get_collection",
    "Retrieve a product collection by id.",
    "/store/collections/:id"
  ),
  listTool(
    "list_categories",
    "List product categories in the active sales channel.",
    "/store/product-categories",
    {
      searchable: true,
      query: ["handle", "parent_category_id"],
      props: {
        handle: { type: "string", description: "Filter by exact category handle." },
        parent_category_id: { type: "string", description: "Filter to children of this category id." },
      },
    }
  ),
  getTool(
    "get_category",
    "Retrieve a product category by id.",
    "/store/product-categories/:id"
  ),
  listTool(
    "list_product_tags",
    "List product tags in the active sales channel.",
    "/store/product-tags",
    { searchable: true }
  ),
  listTool(
    "list_product_types",
    "List product types in the active sales channel.",
    "/store/product-types",
    { searchable: true }
  ),
  listTool(
    "list_product_variants",
    "List product variants in the active sales channel.",
    "/store/product-variants",
    { searchable: true }
  ),
  // --- Storefront config ------------------------------------------------
  listTool(
    "list_regions",
    "List the store's regions (currency + supported countries).",
    "/store/regions"
  ),
  getTool("get_region", "Retrieve a region by id.", "/store/regions/:id"),
  listTool(
    "list_currencies",
    "List the store's enabled currencies.",
    "/store/currencies"
  ),
  listTool(
    "list_return_reasons",
    "List the store's return reasons.",
    "/store/return-reasons"
  ),
  // --- Custom routes ----------------------------------------------------
  listTool(
    "list_raw_materials",
    "Browse raw materials available for customization (name, color, composition, material type).",
    "/store/custom/raw-materials",
    { searchable: true }
  ),
  getTool(
    "get_production_story",
    "Get the public production story (timeline + credits) for a custom design.",
    "/store/custom/designs/:id/production-story"
  ),
  {
    name: "semantic_search",
    description:
      "Natural-language product search (LLM-interpreted, vector search with lexical fallback). Returns storefront products best matching the query.",
    method: "GET",
    path: "/store/ai/search",
    queryParams: ["query", "limit"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 2,
          maxLength: 200,
          description: "Natural-language search query, e.g. 'lightweight cotton summer saree'.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 24,
          default: 6,
          description: "Max results (1-24).",
        },
        ...STORE_PROP,
      },
    },
  },
  // --- Native (container-backed) store discovery ------------------------
  {
    name: "list_stores",
    description:
      "List live storefronts with handle, name, domain, store id, sales channel, and default publishable key. Includes the platform's core/default store (is_default=true, e.g. cicilabel.com) and every partner store. Use this to discover which store to scope catalog queries to.",
    native: "list_stores",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "get_storefront_key",
    description:
      "Resolve a storefront's default publishable API key by partner handle/subdomain or domain, OR the platform core store via 'default'/'main' or its apex domain (cicilabel.com). Returns { handle, name, domain, store_id, sales_channel_id, default_region_id, default_location_id, currency_code, publishable_key, is_default }. Publishable keys are public storefront keys.",
    native: "get_storefront_key",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["store"],
      properties: {
        store: {
          type: "string",
          description:
            "Partner handle/subdomain (e.g. 'acme') or storefront domain.",
        },
      },
    },
  },
  // --- Write tools: cart -> checkout -> pay -----------------------------
  // Gated behind STORE_MCP_ENABLE_WRITE. Each proxies the matching native
  // Medusa /store route, so the route's validators/pricing/scoping still run.
  ...CHECKOUT_WRITE_TOOLS,
]
