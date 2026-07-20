import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"
import { resolveRetailPartnerId } from "../../../modules/partner_billing/resolve-retail-partner"
import partnerOrderLink from "../../../links/partner-order"

export type PartnerOrderContext = {
  order: any
  partner: {
    id: string
    name: string
    handle: string
  } | null
  partnerAdmins: {
    id: string
    email: string
    first_name: string
    last_name: string
    role: string
  }[]
  /** The from address for partner emails: partner+handle@partner.jaalyantra.com */
  partnerFromEmail: string
  partnerFromName: string
  /** The partner store name (falls back to partner name). */
  storeName: string
  /** The partner storefront URL (from storefront_domain / metadata / FRONTEND_URL). */
  storeUrl: string
}

const EMPTY = (order: any): PartnerOrderContext => ({
  order,
  partner: null,
  partnerAdmins: [],
  partnerFromEmail: "",
  partnerFromName: "",
  storeName: "",
  storeUrl: process.env.FRONTEND_URL || "",
})

/**
 * Backfill each line item's `thumbnail` from the live product — root thumbnail
 * first, then the first image by rank. Medusa only ever snapshots the product
 * ROOT thumbnail onto the line item at cart time, so a product that gained its
 * image after the order was placed leaves `item.thumbnail` null forever. Same
 * fallback the partner order API uses (api/partners/orders/[id]/route.ts).
 */
async function fillItemThumbnails(container: any, items: any[]): Promise<void> {
  try {
    const productIdOf = (it: any): string | undefined =>
      it?.product_id || it?.variant?.product?.id || it?.variant?.product_id
    const missing = items.filter((it) => !it?.thumbnail && productIdOf(it))
    const productIds = Array.from(
      new Set(missing.map((it) => productIdOf(it)).filter(Boolean))
    ) as string[]
    if (!productIds.length) return

    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "thumbnail", "images.url", "images.rank"],
      filters: { id: productIds },
    })
    const thumbById = new Map<string, string | null | undefined>(
      (products ?? []).map((p: any) => {
        const firstImage = (p.images ?? [])
          .slice()
          .sort((a: any, b: any) => (a?.rank ?? 0) - (b?.rank ?? 0))[0]?.url
        return [p.id, p.thumbnail || firstImage]
      })
    )
    for (const it of missing) {
      const pid = productIdOf(it)
      const thumb = pid ? thumbById.get(pid) : undefined
      if (thumb) it.thumbnail = thumb
    }
  } catch {
    // best-effort: leave snapshot thumbnails as-is
  }
}

/**
 * Resolve the partner that owns an order — the SAME two-rule ownership the
 * partner API enforces (validatePartnerOrderOwnership):
 *   1. Work order: the D3 partner↔order link (partner_partner_order_order).
 *   2. Retail order: order.sales_channel_id === partner.store.default_sales_channel_id.
 *
 * The previous implementation traversed
 * `sales_channel → store → partner_partner_store_store`, which always returned
 * null (`sales_channel.store` isn't exposed and the link alias doesn't resolve),
 * so partner order emails silently skipped — the templates existed and were
 * active, but the partner never resolved. See #1102 / resolveRetailPartnerId.
 *
 * Also enriches the order with the relations the templates render (items with
 * thumbnails, shipping/billing address) and the partner's store name + URL.
 */
export const resolvePartnerFromOrderStep = createStep(
  "resolve-partner-from-order",
  async (input: { orderId: string }, { container }) => {
    const orderService = container.resolve(
      Modules.ORDER
    ) as IOrderModuleService
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    // 1) Retrieve the order with the relations the templates need.
    const order: any = await orderService.retrieveOrder(input.orderId, {
      relations: ["items", "shipping_address", "billing_address"],
    })

    if (!order) {
      return new StepResponse(EMPTY(null))
    }

    // 2) Resolve the owning partner.
    //    a) Work order: explicit D3 partner↔order link (source of truth).
    let partnerId: string | null = null
    try {
      const { data: links } = await query.graph({
        entity: partnerOrderLink.entryPoint,
        fields: ["partner_id"],
        filters: { order_id: input.orderId },
        pagination: { skip: 0, take: 1 },
      })
      partnerId = (links?.[0] as any)?.partner_id || null
    } catch {
      // link table absent / empty — fall through to retail
    }

    //    b) Retail order: sales-channel ownership rule (#1102).
    if (!partnerId) {
      partnerId = await resolveRetailPartnerId(container, order.sales_channel_id)
    }

    if (!partnerId) {
      return new StepResponse(EMPTY(order))
    }

    // 3) Fetch partner details + active admins + storefront info.
    let partner: any = null
    let admins: any[] = []
    try {
      const partners = await partnerService.listPartners(
        { id: partnerId },
        {
          relations: ["admins"],
          select: [
            "id",
            "name",
            "handle",
            "storefront_domain",
            "metadata",
          ],
        }
      )
      partner = (partners as any[])?.[0] || null
      admins = (partner?.admins || []).filter((a: any) => a.is_active)
    } catch (err) {
      console.warn(
        `[resolve-partner] Failed to fetch partner ${partnerId}:`,
        (err as Error).message
      )
    }

    if (!partner) {
      return new StepResponse(EMPTY(order))
    }

    // 4) Fill missing line-item thumbnails from the live products.
    await fillItemThumbnails(container, (order?.items || []) as any[])

    const handle =
      partner.handle ||
      partner.name?.toLowerCase().replace(/\s+/g, "-") ||
      "partner"
    const fromDomain =
      process.env.MAILEROO_FROM_DOMAIN || "partner.jaalyantra.com"
    const partnerFromEmail = `partner+${handle}@${fromDomain}`
    const partnerFromName = partner.name || "Jaal Yantra Textiles Partner"

    const domain =
      partner.storefront_domain || partner.metadata?.storefront_domain || ""
    const storeUrl = domain
      ? /^https?:\/\//i.test(domain)
        ? domain
        : `https://${domain}`
      : process.env.FRONTEND_URL || ""

    const result: PartnerOrderContext = {
      order,
      partner: { id: partner.id, name: partner.name, handle },
      partnerAdmins: admins.map((a: any) => ({
        id: a.id,
        email: a.email,
        first_name: a.first_name || "",
        last_name: a.last_name || "",
        role: a.role || "admin",
      })),
      partnerFromEmail,
      partnerFromName,
      storeName: partner.name || "",
      storeUrl,
    }

    return new StepResponse(result)
  }
)
