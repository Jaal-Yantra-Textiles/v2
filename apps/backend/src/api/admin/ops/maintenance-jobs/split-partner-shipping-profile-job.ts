import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { updateShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

import {
  ensurePartnerShippingProfileId,
  resolveHouseSalesChannelId,
  resolveHouseShippingProfileId,
} from "../../../../lib/partner-shipping-profile"
import {
  PARTNER_SHIPPING_PROFILE_NAME,
  pickPartnerProfileId,
  pickTargetProfileId,
  shippingSideForLocation,
  shippingSideForProduct,
  type ShippingSide,
} from "../../../../lib/shipping-profile-selection"
import { resolveCoreLocationIds } from "../../../../workflows/consumption-logs/lib/apply-to-inventory"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #1983 — move existing rows onto the strict house/partner shipping split.
 *
 * Founder's decision (2026-09-23): a house option ships house products only, a
 * partner option ships partner products only. New rows are born on the right
 * profile (provisioning, the partner routes, the partner product workflow);
 * this moves the rows that were created while everything shared one profile.
 *
 *  · an OPTION's side is whose building it ships from (`location_ownership`);
 *  · a PRODUCT's side is where it is sold — on the house channel → house.
 *
 * 🔴 The open-order guard. Medusa re-checks product profile against the
 * order's shipping option at FULFILLMENT. An open order whose product and
 * option would end up on different profiles could never be fulfilled, so such
 * a product is SKIPPED and named, not moved. Options and products that move
 * together keep an open partner order consistent, which is the common case.
 *
 * The product move swaps only the product↔profile link (dismiss + create), the
 * same link `createProductsWorkflow` writes. `updateProductsWorkflow` would do
 * it too, but it also emits product-updated events for a change no subscriber
 * needs to hear about.
 */

/** Order statuses that can still be fulfilled. */
const OPEN_ORDER_STATUSES = ["pending", "requires_action"]

/** PURE: the order ids that the move would strand. Exported for unit tests. */
export function ordersStrandedByMove(args: {
  productId: string
  productTarget: ShippingSide
  openOrders: Array<{
    id: string
    display_id?: number | null
    items?: Array<{ product_id?: string | null }> | null
    shipping_methods?: Array<{ shipping_option_id?: string | null }> | null
  }>
  optionTarget: ReadonlyMap<string, ShippingSide>
}): string[] {
  const stranded: string[] = []
  for (const order of args.openOrders) {
    const hasProduct = (order.items ?? []).some(
      (i) => i?.product_id === args.productId
    )
    if (!hasProduct) continue
    const mismatch = (order.shipping_methods ?? []).some((m) => {
      const side = m?.shipping_option_id
        ? args.optionTarget.get(m.shipping_option_id)
        : undefined
      return side !== undefined && side !== args.productTarget
    })
    if (mismatch) stranded.push(`#${order.display_id ?? order.id}`)
  }
  return stranded
}

export const splitPartnerShippingProfileJob: MaintenanceJob = {
  id: "split-partner-shipping-profile",
  label: "Split partner shipping onto its own profile (#1983)",
  description:
    "Move shipping options at partner locations, and products sold only through partner channels, onto the 'Partner Shipping Profile' (created on apply if missing); anything at our own locations or on the house channel goes on the default profile. Strict split: a house option then ships house products only, and vice versa. A product in an open order whose shipping option would end up on the other side is SKIPPED and named. Dry-run previews every move and writes nothing; apply is idempotent.",
  params: [],
  run: async (container, { dry_run }): Promise<MaintenanceJobResult> => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const houseChannelId = await resolveHouseSalesChannelId(container)
    if (!houseChannelId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The house store's sales channel could not be resolved, so no product " +
          "can be placed on a side. Fix the house store first ([house-store] logs)."
      )
    }
    const { coreLocationIds } = await resolveCoreLocationIds(container)

    // Profile ids. On a preview nothing is created: a partner profile that
    // does not exist yet is reported by name.
    const { data: profiles } = await query.graph({
      entity: "shipping_profile",
      fields: ["id", "name", "type"],
    })
    const existingPartnerId = pickPartnerProfileId(profiles || [])
    const housePreviewId = pickTargetProfileId(
      (profiles || []).filter((p: any) => p.id !== existingPartnerId)
    )
    const partnerId = dry_run
      ? existingPartnerId ?? `(new) ${PARTNER_SHIPPING_PROFILE_NAME}`
      : await ensurePartnerShippingProfileId(container)
    const houseId = dry_run
      ? housePreviewId ?? "(house profile unresolved)"
      : await resolveHouseShippingProfileId(container)
    const targetId = (side: ShippingSide) =>
      side === "partner" ? partnerId : houseId

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    // 1. Shipping options, by location.
    const { data: options } = await query.graph({
      entity: "shipping_options",
      fields: [
        "id",
        "name",
        "shipping_profile_id",
        "service_zone.fulfillment_set.location.id",
        "service_zone.fulfillment_set.location.name",
      ],
    })
    const optionTarget = new Map<string, ShippingSide>()
    for (const option of (options || []) as any[]) {
      const location = option?.service_zone?.fulfillment_set?.location
      const side = shippingSideForLocation(location?.id, coreLocationIds)
      optionTarget.set(option.id, side)
      const after = targetId(side)
      if (option.shipping_profile_id === after) continue

      changes.push({
        entity: "shipping_option",
        id: option.id,
        field: `shipping_profile (${option.name})`,
        before: option.shipping_profile_id,
        after,
        note: `${side} — ships from ${location?.name ?? "no location"}`,
      })
      if (!dry_run) {
        try {
          await updateShippingOptionsWorkflow(container).run({
            input: [{ id: option.id, shipping_profile_id: after } as any],
          })
        } catch (e: any) {
          errors.push({ id: option.id, message: e?.message ?? String(e) })
        }
      }
    }

    // 2. Products, by sales channel — with the open-order guard.
    const { data: openOrders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "items.product_id",
        "shipping_methods.shipping_option_id",
      ],
      filters: { status: OPEN_ORDER_STATUSES },
    })
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "sales_channels.id", "shipping_profile.id"],
    })

    let skipped = 0
    for (const product of (products || []) as any[]) {
      const channelIds = (product.sales_channels || []).map((c: any) => c.id)
      const side = shippingSideForProduct(channelIds, houseChannelId)!
      const before = product.shipping_profile?.id ?? null
      const after = targetId(side)
      if (before === after) continue

      const stranded = ordersStrandedByMove({
        productId: product.id,
        productTarget: side,
        openOrders: openOrders || [],
        optionTarget,
      })
      if (stranded.length) {
        skipped++
        errors.push({
          id: product.id,
          message:
            `Skipped "${product.title}": open order(s) ${stranded.join(", ")} ` +
            `ship it on an option that will sit on the other profile. Fulfil ` +
            `or re-ship them, then re-run.`,
        })
        continue
      }

      changes.push({
        entity: "product",
        id: product.id,
        field: `shipping_profile (${product.title})`,
        before,
        after,
        note: `${side} — ${side === "house" ? "on the house channel" : "sold only through partner channels"}`,
      })
      if (!dry_run) {
        try {
          if (before) {
            await link.dismiss({
              [Modules.PRODUCT]: { product_id: product.id },
              [Modules.FULFILLMENT]: { shipping_profile_id: before },
            })
          }
          await link.create({
            [Modules.PRODUCT]: { product_id: product.id },
            [Modules.FULFILLMENT]: { shipping_profile_id: after },
          })
        } catch (e: any) {
          errors.push({ id: product.id, message: e?.message ?? String(e) })
        }
      }
    }

    const moved = (entity: string) =>
      changes.filter((c) => c.entity === entity).length
    const verb = dry_run ? "Would move" : "Moved"
    return {
      job_id: splitPartnerShippingProfileJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary:
        `${verb} ${moved("shipping_option")} shipping option(s) and ` +
        `${moved("product")} product(s) onto their side of the split` +
        (skipped ? `; skipped ${skipped} product(s) held by open orders` : "") +
        ".",
      changes,
      errors: errors.length ? errors : undefined,
    }
  },
}
