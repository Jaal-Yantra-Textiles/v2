import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { partnerStorefrontOrigin } from "../../../lib/carts/recovery-link"
import {
  triggerStorefrontRevalidate,
  type RevalidateOutcome,
} from "../../../api/partners/storefront/helpers"

/**
 * The product-page route pattern on the partner storefront. Revalidating the
 * PATTERN (not one URL) clears that page for every country and handle, which
 * is the only way to reach it from here: the storefront's spec cache tag is
 * scoped per visitor, so no tag the backend could name would match.
 */
export const PRODUCT_PAGE_ROUTE = "/[countryCode]/products/[handle]"

/**
 * Which partner storefront(s) a product appears on: each of its sales
 * channels → the store whose DEFAULT channel it is → that store's partner →
 * the partner's live origin. Pure over the query result so it is testable.
 * Channels owned by no partner store (our own shop) resolve to nothing.
 */
export function storefrontOriginsFor(
  stores: Array<{ partner?: any } | null | undefined>
): string[] {
  const origins = new Set<string>()
  for (const store of stores) {
    const origin = partnerStorefrontOrigin(store?.partner ?? null)
    if (origin) origins.add(origin)
  }
  return [...origins]
}

/**
 * After a product spec is saved, tell the storefront(s) showing it to drop
 * their cached product pages, so the new colours/choices appear now instead
 * of whenever the page cache happens to expire (GOF, 2026-11-28: the dye
 * palette stayed invisible for hours).
 *
 * Fire-and-forget by design: never throws, never blocks the save. Returns the
 * outcomes so a caller (or a test) can see what happened.
 */
export async function revalidateProductStorefronts(
  container: any,
  productIds: string[]
): Promise<Array<{ origin: string; outcome: RevalidateOutcome }>> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return []
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "sales_channels.id"],
      filters: { id: ids },
    })
    const channelIds = [
      ...new Set(
        (products || []).flatMap((p: any) =>
          (p?.sales_channels || []).map((sc: any) => sc?.id).filter(Boolean)
        )
      ),
    ]
    if (!channelIds.length) return []
    const { data: stores } = await query.graph({
      entity: "store",
      fields: [
        "id",
        "partner.storefront_domain",
        "partner.custom_domain",
        "partner.custom_domain_verified",
      ],
      filters: { default_sales_channel_id: channelIds },
    })
    const origins = storefrontOriginsFor(stores || [])
    return await Promise.all(
      origins.map(async (origin) => ({
        origin,
        outcome: await triggerStorefrontRevalidate(
          { domain: origin },
          { paths: [PRODUCT_PAGE_ROUTE] }
        ),
      }))
    )
  } catch (e: any) {
    console.warn(
      `[spec-revalidate] could not refresh storefronts for ${ids.join(",")}: ${e?.message || e}`
    )
    return []
  }
}
