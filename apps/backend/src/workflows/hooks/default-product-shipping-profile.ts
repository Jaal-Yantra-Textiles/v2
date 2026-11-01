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

    const profileBySide = new Map<string, string>()
    const links: any[] = []
    for (const { product_id, side } of missing) {
      if (!profileBySide.has(side)) {
        profileBySide.set(
          side,
          await resolveShippingProfileIdForSide(container, side)
        )
      }
      links.push({
        [Modules.PRODUCT]: { product_id },
        [Modules.FULFILLMENT]: { shipping_profile_id: profileBySide.get(side) },
      })
    }

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
