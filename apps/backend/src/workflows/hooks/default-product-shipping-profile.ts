import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import {
  resolveHouseSalesChannelId,
  resolveShippingProfileIdForSide,
} from "../../lib/partner-shipping-profile"
import { productsMissingShippingProfile } from "../../lib/shipping-profile-selection"

/**
 * #1982 — no product is born without a shipping profile.
 *
 * `POST /admin/products` (the admin form and the MCP `create_product` tool)
 * passes no `shipping_profile_id`, and core writes no link without one. The
 * product then cannot be checked out or fulfilled: "The shipping option you
 * have selected don't allow fulfillment of this item".
 *
 * This runs after core's own link step, so a caller that DID pass a profile
 * (the partner, design, WhatsApp and media creators) is left alone.
 *
 * It must never BLOCK a product: when the profile for a side cannot be
 * decided (e.g. a fresh database with two `default` profiles, where
 * `resolveHouseShippingProfileId` refuses to guess), those products are left
 * unlinked — exactly the pre-#1982 behaviour — and a warning is logged. The
 * e2e seed hit this on 2026-11-02 and every product create failed.
 */
createProductsWorkflow.hooks.productsCreated(
  async ({ products }, { container }) => {
    const ids = (products || []).map((p: any) => p.id).filter(Boolean)
    if (!ids.length) return new StepResponse([], [])

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "shipping_profile.id", "sales_channels.id"],
      filters: { id: ids },
    })

    const houseChannelId = await resolveHouseSalesChannelId(container)
    const missing = productsMissingShippingProfile(data || [], houseChannelId)
    if (!missing.length) return new StepResponse([], [])

    const profileBySide = new Map<string, string | null>()
    const links: any[] = []
    for (const { product_id, side } of missing) {
      if (!profileBySide.has(side)) {
        try {
          profileBySide.set(side, await resolveShippingProfileIdForSide(container, side))
        } catch (e: any) {
          profileBySide.set(side, null)
          const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
          logger?.warn?.(
            `[#1982] no ${side} shipping profile linked to new product(s): ${e?.message ?? e}`
          )
        }
      }
      const shippingProfileId = profileBySide.get(side)
      if (!shippingProfileId) continue
      links.push({
        [Modules.PRODUCT]: { product_id },
        [Modules.FULFILLMENT]: { shipping_profile_id: shippingProfileId },
      })
    }
    if (!links.length) return new StepResponse([], [])

    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    await link.create(links)
    return new StepResponse(links, links)
  },
  async (links, { container }) => {
    if (!links?.length) return
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    await link.dismiss(links)
  }
)
