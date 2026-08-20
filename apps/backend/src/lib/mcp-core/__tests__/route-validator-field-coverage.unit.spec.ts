/**
 * Every MCP write tool is checked against the ACTUAL zod validator its route
 * registers — resolved from `src/api/middlewares.ts`, not transcribed here.
 *
 * ## Why this file exists, on top of the two tests either side of it
 *
 * - `required-args.unit.spec.ts` asserts `bodyParams ⊆ inputSchema` (#1348).
 * - `product-tool-field-coverage.unit.spec.ts` asserts the reverse direction —
 *   route-accepts ⊆ tool-advertises — for four hand-bound product/variant tools
 *   (#1393, the `weight` silent-strip).
 *
 * Both are per-tool. Neither could answer the question #1394 item 3 actually
 * asked: *which of the 141 write tools advertise fewer fields than their route
 * accepts?* Answering it by hand does not scale and rots on the next registry
 * row. So this test resolves the binding mechanically:
 *
 *   `defineMiddlewares` is imported for real, with `validateAndTransformBody`
 *   mocked to tag each middleware with the schema it closed over. Matching a
 *   tool's `path` + `method` against `matcher` + `methods` yields the route's
 *   own contract, whatever it is today.
 *
 * ## The three failures it catches, in descending severity
 *
 * 1. **Stray** — a `bodyParams` entry the validator does not accept. Medusa's
 *    `zodValidator` forces `.strict()`, so this is a 400 on every call.
 * 2. **Unadvertised required field** — the validator requires it, the tool
 *    never offers it. Also a guaranteed 400, and invisible to the #1371
 *    required-args gate, because that gate reads the tool's OWN `required`
 *    list — which is precisely the thing that is wrong.
 * 3. **Unadvertised optional field** — the `weight` class. `pick()` is an
 *    allowlist walk, so the field is dropped in silence; the dry-run plan is
 *    built from the already-picked body, so a rehearsal renders identically
 *    whether or not it was sent. `ok: true`, nothing written.
 *
 * ## The two opt-out lists are the point
 *
 * `DELIBERATELY_OMITTED` and `NO_ROUTE_VALIDATOR` are not silencers. They are
 * the mechanism that turns "nobody ever looked" into "someone looked and wrote
 * down why". Adding a row should feel like a small commitment, because it is.
 */

jest.mock("@medusajs/framework/http", () => {
  const actual = jest.requireActual("@medusajs/framework/http")
  return {
    ...actual,
    // Tag rather than validate: the test needs the schema each route closed
    // over, and running real validation here would need a real request.
    validateAndTransformBody: (schema: any) => {
      const fn: any = (_req: any, _res: any, next: any) => next()
      fn.__schema = schema
      return fn
    },
  }
})

import { PARTNER_MCP_TOOLS } from "../../../api/partners/mcp/lib/registry"
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import type { McpToolDef } from "../types"
import { buildToolInputSchema } from "../schema"

/**
 * Tools whose route registers no body validator in `middlewares.ts`, with the
 * reason. Most validate inside the handler, or wrap a core route whose
 * validator core registers itself — for those, the contract check belongs in
 * `product-tool-field-coverage.unit.spec.ts`, which binds core's validator
 * directly.
 *
 * A tool landing here is NOT proven safe. It is proven unchecked-by-this-file.
 */
const NO_ROUTE_VALIDATOR = new Set<string>([
  // Core routes: core registers its own validator, so it never appears in this
  // repo's middlewares config. The four product/variant ones are contract-
  // checked against core's imported validators in the sibling spec.
  "admin:create_product",
  "admin:update_product",
  "admin:update_product_variant",
  "admin:create_product_for_partner",
  "admin:update_customer",
  "admin:update_order",
  "admin:create_order_fulfillment",
  "admin:create_order_shipment",
  "admin:mark_order_fulfillment_delivered",
  "admin:cancel_order_fulfillment",
  "admin:create_order_edit",
  "admin:add_order_edit_items",
  "admin:update_order_edit_item",
  "partner:create_order_fulfillment",
  "partner:create_fulfillment_shipment",
  "partner:transfer_order",
  "partner:capture_payment",
  "partner:refund_payment",
  "partner:request_order_edit",
  "partner:create_return",
  "partner:set_inventory_level",
  "partner:set_inventory_levels_batch",
  "partner:create_customer",
  "partner:update_customer",
  "partner:add_customer_address",
  "partner:create_customer_group",
  "partner:update_customer_group",
  "partner:add_customers_to_group",
  "partner:create_product_category",
  "partner:update_product_category",
  "partner:set_category_products",
  "partner:create_product_collection",
  "partner:update_product_collection",
  "partner:set_collection_products",
  "partner:create_product_tag",
  "partner:create_product_type",
  "partner:update_product_type",
  "partner:create_price_preference",
  "partner:update_price_preference",
  "partner:create_inventory_item",
  "partner:update_inventory_item",
  "partner:create_reservation",
  "partner:update_reservation",
  "partner:add_store_product",
  "partner:update_store_product",
  "partner:add_product_option",
  "partner:add_product_variant",
  "partner:update_product_variant",
  "partner:add_store_location",

  // This repo's routes that validate inside the handler rather than through
  // `validateAndTransformBody`. Each is a candidate for a real validator; none
  // has one today, so there is no contract for this file to check against.
  "admin:resolve_admin_query",
  "admin:link_partner_people",
  "admin:unlink_partner_people",
  "admin:create_partner_subscription",
  "admin:update_partner",
  "admin:set_partner_person_types",
  "admin:add_partner_admin",
  "admin:update_partner_admin",
  "admin:connect_partner_whatsapp",
  "admin:reject_partner_product",
  "admin:produce_order_designs",
  "admin:create_order_shipping_label",
  "admin:attach_order_awb",
  "admin:update_production_run",
  "admin:update_production_run_task",
  "admin:unlink_design_partner",
  "admin:produce_designs",
  "admin:add_design_construction_detail",
  "partner:add_design_media",
  "partner:describe_image",
  "partner:update_storefront_website",
  "partner:update_storefront_analytics",
  "partner:create_storefront_page",
  "partner:update_storefront_domain",
  "partner:start_inventory_order",
  "partner:submit_inventory_order_payment",
  "partner:ready_inventory_order_for_delivery",
  "partner:create_inventory_order_shipment",
  "partner:complete_inventory_order",
])

/**
 * Accepted-but-not-advertised fields, keyed `<surface>:<tool>`, with the reason.
 *
 * Two kinds of entry live here and they are labelled differently on purpose:
 *   - a real product decision ("images go through the media tools")
 *   - a known gap someone has not closed yet ("GAP (#1394):" …) — a promise to
 *     come back, not a claim that the omission is correct.
 */
const DELIBERATELY_OMITTED: Record<string, Record<string, string>> = {
  "admin:create_social_post": {
    post_url: "set by the publisher callback, not by the author",
    posted_at: "as post_url",
    insights: "written by the analytics sync only",
    media_attachments: "media goes through the media tools",
    notes: "GAP (#1394): plausible assistant field, nobody has asked for it",
    error_message: "written by the publisher on failure",
    related_item_type: "GAP (#1394): linking is done by a separate tool",
    related_item_id: "GAP (#1394): as related_item_type",
  },
  "admin:create_partner_task": {
    template_names: "see dispatch_template_names — approval INTENT, not a task field",
    eventable: "notification plumbing, not an assistant concern",
    notifiable: "as eventable",
    message: "as eventable",
    child_tasks: "nested creation is a second, untested write path",
    dependency_type: "GAP (#1394): only meaningful alongside child_tasks",
  },
  "admin:update_partner_task": {
    eventable: "notification plumbing, not an assistant concern",
    notifiable: "as eventable",
    message: "as eventable",
  },
  "admin:update_design_task": {
    eventable: "notification plumbing, not an assistant concern",
    notifiable: "as eventable",
  },
  "admin:create_partner": {
    auth_identity_id: "auth wiring, never assistant-written",
  },
  "admin:create_design": {
    design_files: "files go through the media tools",
    media_files: "as design_files",
    moodboard: "as design_files",
    custom_sizes: "GAP (#1394): structured size payload, no schema written yet",
    color_palette: "GAP (#1394): as custom_sizes",
    feedback_history: "append-only log written by the review flow",
    origin_source: "provenance stamped by the creating surface",
    customer_id_for_link: "linking is a separate tool",
  },
  "admin:update_design": {
    design_files: "files go through the media tools",
    media_files: "as design_files",
    moodboard: "as design_files",
    custom_sizes: "GAP (#1394): structured size payload, no schema written yet",
    color_palette: "GAP (#1394): as custom_sizes",
    feedback_history: "append-only log written by the review flow",
    origin_source: "provenance stamped by the creating surface",
    customer_id_for_link: "linking is a separate tool",
  },
  "admin:create_design_production_run": {
    template_ids: "GAP (#1394): template selection by id, name-based is advertised",
    template_names: "see dispatch_template_names — approval INTENT",
  },
  "admin:extract_inventory_from_image": {
    threadId: "mastra conversation plumbing, injected by the surface",
    resourceId: "as threadId",
  },
  "admin:create_raw_material_group": {
    media: "media goes through the media tools",
  },
  "admin:create_crm_contact": {
    next_follow_up_at: "GAP (#1394): nothing acts on crm.* follow-ups yet",
  },
  "partner:update_partner_profile": {
    logo: "media goes through the media tools",
    status: "platform-controlled; a partner cannot verify itself",
    is_verified: "as status",
    auto_accept_production_runs:
      "GAP (#1394): real capability gap — the policy gate exists (#1353) but no tool sets it",
  },
  "partner:create_store": {
    partner_id: "derived from the authenticated partner, never supplied",
  },
  "partner:log_design_consumption": {
    quantityBasis: "GAP (#1394): camelCase outlier in a snake_case body; fix the route, not the tool",
  },
  "partner:log_production_run_consumption": {
    quantityBasis: "GAP (#1394): as log_design_consumption",
  },
  "partner:update_storefront_page": {
    published_at: "publishing is its own action, not a field write",
    genMetaDataLLM: "server-side generation flag, not an assistant argument",
    public_metadata: "GAP (#1394): open blob, no shape to advertise",
  },
  "partner:update_store": {
    default_region_id: "GAP (#1394): real capability gap — regions have their own tools but the default is unsettable",
    default_location_id: "GAP (#1394): as default_region_id, and it gates fulfilment",
  },
  "partner:add_store_region": {
    automatic_taxes: "GAP (#1394): tax behaviour, deliberately not assistant-set for now",
    is_tax_inclusive: "GAP (#1394): as automatic_taxes",
  },
  "partner:update_store_region": {
    automatic_taxes: "GAP (#1394): tax behaviour, deliberately not assistant-set for now",
    is_tax_inclusive: "GAP (#1394): as automatic_taxes",
  },
  "partner:add_store_sales_channel": {
    is_disabled: "a channel is created enabled; disabling is its own action",
  },
  "partner:add_store_tax_region": {
    parent_id: "province-level regions are created from the parent's tool context",
    metadata: "partner tools do not expose raw metadata writes",
  },
  "partner:add_store_shipping_option": {
    type: "GAP (#1394): structured label/code object, no schema written yet",
    type_id: "GAP (#1394): alternative to `type`, same gap",
    rules: "GAP (#1394): rule arrays need their own schema",
    data: "provider-specific blob, never assistant-written",
  },
  "partner:update_design": {
    design_files: "files go through the media tools",
    media_files: "as design_files",
    moodboard: "as design_files",
    thumbnail_url: "as design_files",
    custom_sizes: "GAP (#1394): structured size payload, no schema written yet",
    color_palette: "GAP (#1394): as custom_sizes",
    colors: "GAP (#1394): as custom_sizes",
    size_sets: "GAP (#1394): as custom_sizes",
    metadata: "partner tools do not expose raw metadata writes",
    estimated_cost: "costing is an admin concern",
    inspiration_sources: "GAP (#1394): free-form array, no schema written yet",
  },
}

/** Keys a zod object validator accepts, unwrapping effects/pipes. */
const unwrap = (s: any): any => {
  let cur = s
  for (let i = 0; i < 10 && cur; i++) {
    if (cur.shape || cur?._def?.shape) return cur
    cur = cur._def?.schema ?? cur._def?.innerType ?? cur._def?.in ?? null
  }
  return s
}

const acceptedKeys = (schema: any): string[] => {
  const s = unwrap(schema)
  const shape = s?.shape ?? s?._def?.shape?.() ?? {}
  return Object.keys(shape)
}

const requiredKeys = (schema: any): string[] => {
  const s = unwrap(schema)
  const shape = s?.shape ?? s?._def?.shape?.() ?? {}
  return Object.keys(shape).filter((k) => {
    try {
      return shape[k]?.isOptional?.() === false
    } catch {
      return false
    }
  })
}

type Bound = {
  key: string
  tool: McpToolDef
  accepted: string[]
  required: string[]
}

const normalizePath = (p: string) => p.replace(/:[A-Za-z0-9_]+/g, ":P")

const writeTools: Array<{ key: string; tool: McpToolDef }> = [
  ...ADMIN_MCP_TOOLS.filter((t) => t.bodyParams?.length).map((t) => ({
    key: `admin:${t.name}`,
    tool: t,
  })),
  ...PARTNER_MCP_TOOLS.filter((t) => t.bodyParams?.length).map((t) => ({
    key: `partner:${t.name}`,
    tool: t,
  })),
]

// Required at module scope, after the mock above is installed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const middlewareConfig = require("../../../api/middlewares").default
const routeTable: Array<{ matcher: string; methods: string[]; schema: any }> = (
  middlewareConfig?.routes ?? []
)
  .map((r: any) => ({
    matcher: normalizePath(String(r.matcher)),
    methods: r.methods ?? [],
    schema: (r.middlewares ?? []).find((m: any) => m?.__schema)?.__schema,
  }))
  .filter((r: any) => r.schema)

const bound: Bound[] = []
const unbound: string[] = []

for (const { key, tool } of writeTools) {
  const hit = routeTable.find(
    (r) =>
      r.matcher === normalizePath(String(tool.path)) &&
      r.methods.includes(tool.method ?? "GET")
  )
  const accepted = hit ? acceptedKeys(hit.schema) : []
  if (!hit || accepted.length === 0) {
    unbound.push(key)
    continue
  }
  bound.push({ key, tool, accepted, required: requiredKeys(hit.schema) })
}

describe("MCP write tools match the validators their routes actually register", () => {
  it("resolved a meaningful share of the registry — the harness itself works", () => {
    // Without this, a broken mock or a renamed `routes` key would empty the
    // table and every assertion below would pass over nothing.
    expect(routeTable.length).toBeGreaterThan(150)
    expect(bound.length).toBeGreaterThan(50)
  })

  it("every write tool is either bound to a validator or written down as unbound", () => {
    const undeclared = unbound.filter((k) => !NO_ROUTE_VALIDATOR.has(k))
    expect(undeclared).toEqual([])
  })

  it("has no stale entries in the unbound list", () => {
    // An entry for a tool that now HAS a validator is a note about a world that
    // stopped existing — and it would hide that tool from every check below.
    const boundKeys = new Set(bound.map((b) => b.key))
    const stale = [...NO_ROUTE_VALIDATOR].filter((k) => boundKeys.has(k))
    expect(stale).toEqual([])
  })

  it("advertises no body param its route would reject (a stray is a 400)", () => {
    const strays = bound
      .map(({ key, tool, accepted }) => ({
        key,
        strays: (tool.bodyParams ?? []).filter((f) => !accepted.includes(f)),
      }))
      .filter((r) => r.strays.length)

    expect(strays).toEqual([])
  })

  it("advertises every field its route REQUIRES (an unadvertised required field is a 400)", () => {
    const missing = bound
      .map(({ key, tool, required }) => ({
        key,
        missing: required.filter((f) => !(tool.bodyParams ?? []).includes(f)),
      }))
      .filter((r) => r.missing.length)

    expect(missing).toEqual([])
  })

  it("advertises every accepted field, or names it as a deliberate omission", () => {
    const unaccounted = bound
      .map(({ key, tool, accepted }) => {
        const advertised = new Set(tool.bodyParams ?? [])
        const omitted = DELIBERATELY_OMITTED[key] ?? {}
        return {
          key,
          unaccounted: accepted.filter(
            (f) => !advertised.has(f) && !(f in omitted)
          ),
        }
      })
      .filter((r) => r.unaccounted.length)

    expect(unaccounted).toEqual([])
  })

  it("has no stale entries in the deliberate-omission lists", () => {
    const stale = Object.entries(DELIBERATELY_OMITTED)
      .map(([key, omitted]) => {
        const b = bound.find((x) => x.key === key)
        // A key for a tool that is no longer bound cannot be checked; the
        // unbound-list assertions cover that case.
        if (!b) return { key, stale: [] as string[] }
        return { key, stale: Object.keys(omitted).filter((f) => !b.accepted.includes(f)) }
      })
      .filter((r) => r.stale.length)

    expect(stale).toEqual([])
  })

  it("declares every advertised body param in the schema the model actually sees", () => {
    // The EFFECTIVE schema, not the raw registry row: `buildToolInputSchema`
    // injects the framework args, and a guarded tool's `reason` doubles as a
    // real body param (cancel_production_run persists it as the cancellation
    // reason). Reading the raw row here would report that as undeclared.
    const undeclared = bound
      .map(({ key, tool }) => {
        const props = Object.keys(buildToolInputSchema(tool)?.properties ?? {})
        return {
          key,
          undeclared: (tool.bodyParams ?? []).filter((f) => !props.includes(f)),
        }
      })
      .filter((r) => r.undeclared.length)

    expect(undeclared).toEqual([])
  })
})
