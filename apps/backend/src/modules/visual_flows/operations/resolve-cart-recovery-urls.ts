import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"
import { resolvePartnerStorefrontForSalesChannel } from "../../../workflows/google_merchant/steps/resolve-partner-landing-base"

/**
 * Resolve cart-recovery URLs operation (#449).
 *
 * The "Cart Recovery — Hourly Discoverer" flow builds the recovery link for
 * every abandoned cart from a single global `STORE_URL` constant baked into an
 * `execute_code` node (see `src/scripts/seed-cart-recovery-flow.ts`). On a
 * multi-storefront platform that's wrong: a cart belonging to partner A's
 * sales channel gets a checkout link on the root/another store, so the shopper
 * lands on a storefront that doesn't hold their cart.
 *
 * This op enriches an already-discovered list of carts with a recovery link
 * pointed at the storefront that actually owns each cart, derived from the
 * cart's `sales_channel_id`:
 *
 *   sales_channel → store (default_sales_channel_id) → partner (partner_stores)
 *
 * It reuses {@link resolvePartnerStorefrontForSalesChannel} (built for #521's
 * admin abandoned-cart view) so the resolution rules stay in one place, and
 * falls back to a configurable base (default `STORE_URL`) whenever a cart isn't
 * tied to a partner storefront — so behaviour is never *worse* than today.
 *
 * Why this isn't doable inside the existing `execute_code` discoverer:
 *   - resolving the owning partner needs `query.graph` multi-hop joins that the
 *     sandboxed code node can't safely run, and
 *   - per-channel resolution should be cached across carts (many carts share a
 *     channel) rather than re-queried per row.
 *
 * Output shape feeds straight back into the email/bulk-trigger step:
 *   `{ carts: [...enriched], records, count, with_partner_storefront,
 *      fallback_count, resolved_channels }`
 * Each enriched cart keeps its original fields plus `cart_url`,
 * `unsubscribe_url`, `storefront_base`, `partner_id` and
 * `partner_storefront_resolved`.
 */

const DEFAULT_CART_PATH = "/checkout/cart/{id}"
const DEFAULT_UNSUBSCRIBE_PATH = "/unsubscribe?cart_id={id}"

const resolveCartRecoveryUrlsOptionsSchema = z.object({
  /** Array of cart objects (or a `{{ variable }}` ref resolving to one). */
  carts: z.union([z.string(), z.array(z.any())]).optional(),
  /** Field on each cart holding its id. */
  id_field: z.string().default("id"),
  /** Field on each cart holding its sales-channel id. */
  sales_channel_field: z.string().default("sales_channel_id"),
  /** Path template appended to the base for the checkout link. `{id}` → cart id. */
  cart_path: z.string().default(DEFAULT_CART_PATH),
  /** Path template for the unsubscribe link. `{id}` → cart id. */
  unsubscribe_path: z.string().default(DEFAULT_UNSUBSCRIBE_PATH),
  /**
   * Base used when a cart isn't tied to a partner storefront. Defaults to the
   * `STORE_URL` env (matching the legacy seeded behaviour) then a hard default.
   */
  fallback_base: z.string().optional(),
  /** Cap on carts processed in one run. */
  max_carts: z.number().int().min(1).max(20_000).default(5_000),
})

export type EnrichableCart = Record<string, any>

export type EnrichedCart = EnrichableCart & {
  cart_url: string
  unsubscribe_url: string
  storefront_base: string
  partner_id: string | null
  partner_storefront_resolved: boolean
}

/**
 * Pure: build the recovery + unsubscribe URLs for a cart from a storefront
 * base and id. The base is trimmed of trailing slashes; `{id}` placeholders in
 * the path templates are substituted. Exported for unit testing.
 */
export function buildRecoveryUrls(
  base: string,
  cartId: string,
  opts?: { cartPath?: string; unsubscribePath?: string }
): { cart_url: string; unsubscribe_url: string } {
  const b = String(base ?? "").replace(/\/+$/, "")
  const cartPath = opts?.cartPath ?? DEFAULT_CART_PATH
  const unsubscribePath = opts?.unsubscribePath ?? DEFAULT_UNSUBSCRIBE_PATH
  const sub = (p: string) => p.replace(/\{id\}/g, String(cartId ?? ""))
  return {
    cart_url: b + sub(cartPath),
    unsubscribe_url: b + sub(unsubscribePath),
  }
}

/**
 * Pure: roll up counts over an enriched cart list. Exported for unit testing.
 */
export function summarizeRecoveryUrlRun(enriched: EnrichedCart[]): {
  count: number
  with_partner_storefront: number
  fallback_count: number
} {
  const count = enriched.length
  let withPartner = 0
  for (const c of enriched) {
    if (c.partner_storefront_resolved) withPartner++
  }
  return {
    count,
    with_partner_storefront: withPartner,
    fallback_count: count - withPartner,
  }
}

export const resolveCartRecoveryUrlsOperation: OperationDefinition = {
  type: "resolve_cart_recovery_urls",
  name: "Resolve Cart Recovery URLs",
  description:
    "Enriches abandoned carts with a recovery link pointed at the partner storefront that owns each cart (derived from sales_channel_id), instead of a single global STORE_URL. Falls back to the configured base when a cart isn't tied to a partner store. Feeds the recovery email/bulk-trigger step.",
  icon: "shopping-cart",
  category: "data",
  optionsSchema: resolveCartRecoveryUrlsOptionsSchema,

  defaultOptions: {
    id_field: "id",
    sales_channel_field: "sales_channel_id",
    cart_path: DEFAULT_CART_PATH,
    unsubscribe_path: DEFAULT_UNSUBSCRIBE_PATH,
    max_carts: 5_000,
  },

  execute: async (
    options: any,
    context: OperationContext
  ): Promise<OperationResult> => {
    try {
      const parsed = resolveCartRecoveryUrlsOptionsSchema.parse(options ?? {})

      // `carts` is typically a `{{ discoverer.carts }}` reference — interpolate
      // against the data chain so we get the actual array, not the literal.
      const resolvedCarts =
        parsed.carts !== undefined
          ? interpolateVariables(parsed.carts, context.dataChain)
          : context.dataChain.$last

      const carts: EnrichableCart[] = Array.isArray(resolvedCarts)
        ? resolvedCarts.slice(0, parsed.max_carts)
        : []

      const fallbackBase =
        parsed.fallback_base ||
        process.env.STORE_URL ||
        "https://cicilabel.com"

      const query: any = context.container.resolve(
        ContainerRegistrationKeys.QUERY
      )

      // Cache resolution per sales-channel — many carts share a channel, so
      // we resolve each channel's partner storefront base at most once.
      const baseByChannel = new Map<string, string | null>()
      const partnerByChannel = new Map<string, string | null>()

      const enriched: EnrichedCart[] = []
      for (const cart of carts) {
        const cartId = String(cart?.[parsed.id_field] ?? "")
        const channelId = cart?.[parsed.sales_channel_field] as
          | string
          | null
          | undefined

        let partnerBase: string | null = null
        let partnerId: string | null = null
        if (channelId) {
          if (baseByChannel.has(channelId)) {
            partnerBase = baseByChannel.get(channelId) ?? null
            partnerId = partnerByChannel.get(channelId) ?? null
          } else {
            const owner = await resolvePartnerStorefrontForSalesChannel(
              query,
              channelId
            )
            partnerBase = owner?.storefront_base ?? null
            partnerId = owner?.id ?? null
            baseByChannel.set(channelId, partnerBase)
            partnerByChannel.set(channelId, partnerId)
          }
        }

        const resolved = Boolean(partnerBase)
        const base = partnerBase || fallbackBase
        const urls = buildRecoveryUrls(base, cartId, {
          cartPath: parsed.cart_path,
          unsubscribePath: parsed.unsubscribe_path,
        })

        enriched.push({
          ...cart,
          cart_url: urls.cart_url,
          unsubscribe_url: urls.unsubscribe_url,
          storefront_base: base,
          partner_id: partnerId,
          partner_storefront_resolved: resolved,
        })
      }

      const summary = summarizeRecoveryUrlRun(enriched)

      return {
        success: true,
        data: {
          carts: enriched,
          // `records` aliases `carts` so array-output panels work too.
          records: enriched,
          count: summary.count,
          with_partner_storefront: summary.with_partner_storefront,
          fallback_count: summary.fallback_count,
          resolved_channels: baseByChannel.size,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
