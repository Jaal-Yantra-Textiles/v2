import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"

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
}

/**
 * Resolves the partner associated with an order by traversing:
 *   order → sales_channel → store → partner_store link → partner → admins
 *
 * Returns null partner and empty admins if the order has no partner association.
 */
export const resolvePartnerFromOrderStep = createStep(
  "resolve-partner-from-order",
  async (input: { orderId: string }, { container }) => {
    const orderService = container.resolve(
      Modules.ORDER
    ) as IOrderModuleService
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    // 1) Retrieve the order
    const order: any = await orderService.retrieveOrder(input.orderId, {
      relations: ["items"],
    })

    if (!order) {
      return new StepResponse({
        order: null,
        partner: null,
        partnerAdmins: [],
        partnerFromEmail: "",
        partnerFromName: "",
      } as PartnerOrderContext)
    }

    // 2) Find the store for this order via sales_channel
    //    Medusa links: sales_channel ↔ store, order has sales_channel_id
    let storeId: string | null = null

    if (order.sales_channel_id) {
      try {
        // Query the sales_channel → store link
        const { data: scStoreLinks } = await query.graph({
          entity: "sales_channel",
          fields: ["id", "store.id"],
          filters: { id: order.sales_channel_id },
        })
        storeId = scStoreLinks?.[0]?.store?.id || null
      } catch {
        // Fallback: query stores directly to find one
      }
    }

    // If no store found via sales channel, try to find the default store
    if (!storeId) {
      try {
        const { data: stores } = await query.graph({
          entity: "store",
          fields: ["id"],
          pagination: { skip: 0, take: 1 },
        })
        storeId = stores?.[0]?.id || null
      } catch {
        // No store at all
      }
    }

    if (!storeId) {
      return new StepResponse({
        order,
        partner: null,
        partnerAdmins: [],
        partnerFromEmail: "",
        partnerFromName: "",
      } as PartnerOrderContext)
    }

    // 3) Find the partner linked to this store via the partner_partner_store_store link
    let partnerId: string | null = null
    try {
      const { data: partnerStoreLinks } = await query.graph({
        entity: "partner_partner_store_store",
        fields: ["partner_id"],
        filters: { store_id: storeId },
        pagination: { skip: 0, take: 1 },
      })
      partnerId = partnerStoreLinks?.[0]?.partner_id || null
    } catch {
      // Link table might not exist or be empty
    }

    if (!partnerId) {
      return new StepResponse({
        order,
        partner: null,
        partnerAdmins: [],
        partnerFromEmail: "",
        partnerFromName: "",
      } as PartnerOrderContext)
    }

    // 4) Fetch partner details + active admins
    let partner: any = null
    let admins: any[] = []

    try {
      const partners = await partnerService.listPartners(
        { id: partnerId },
        { relations: ["admins"], select: ["id", "name", "handle"] }
      )
      partner = (partners as any[])?.[0] || null
      admins = (partner?.admins || []).filter((a: any) => a.is_active)
    } catch (err) {
      console.warn(
        `[resolve-partner] Failed to fetch partner ${partnerId}:`,
        (err as Error).message
      )
    }

    const handle = partner?.handle || partner?.name?.toLowerCase().replace(/\s+/g, "-") || "partner"
    const fromDomain = process.env.MAILEROO_FROM_DOMAIN || "partner.jaalyantra.com"
    const partnerFromEmail = `partner+${handle}@${fromDomain}`
    const partnerFromName = partner?.name || "Jaal Yantra Textiles Partner"

    const result: PartnerOrderContext = {
      order,
      partner: partner
        ? { id: partner.id, name: partner.name, handle }
        : null,
      partnerAdmins: admins.map((a: any) => ({
        id: a.id,
        email: a.email,
        first_name: a.first_name || "",
        last_name: a.last_name || "",
        role: a.role || "admin",
      })),
      partnerFromEmail,
      partnerFromName,
    }

    return new StepResponse(result)
  }
)
