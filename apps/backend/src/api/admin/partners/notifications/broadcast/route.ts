/**
 * @file Admin broadcast notifications route
 * @description POST /admin/partners/notifications/broadcast — fan a single
 * notification out to all (or a filtered subset of) partners, reusing the
 * shared `createPartnerNotification` feed-channel helper. Mirrors the existing
 * partner notification create path (src/lib/notifications/create-partner-notification.ts)
 * rather than inventing a new write path.
 * @module API/Admin/Partners/Notifications/Broadcast
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createPartnerNotification } from "../../../../../lib/notifications/create-partner-notification"
import {
  selectBroadcastPartnerIds,
  summarizeBroadcast,
  type BroadcastResult,
  type PartnerLite,
} from "./lib"
import type { AdminBroadcastNotificationSchema } from "./validators"

const PAGE_SIZE = 200

/**
 * Page through every partner so a broadcast is never silently truncated.
 */
async function fetchAllPartners(scope: any): Promise<PartnerLite[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const partners: PartnerLite[] = []
  let skip = 0

  // Bounded loop: stop when a page comes back short or we've hit the count.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, metadata } = await query.graph({
      entity: "partners",
      fields: ["id", "status"],
      pagination: { skip, take: PAGE_SIZE, order: { created_at: "ASC" } },
    })

    const page = (data as PartnerLite[]) || []
    partners.push(...page)

    const count = (metadata as any)?.count ?? partners.length
    skip += PAGE_SIZE
    if (page.length < PAGE_SIZE || partners.length >= count) break
  }

  return partners
}

export const POST = async (
  req: MedusaRequest<AdminBroadcastNotificationSchema>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as AdminBroadcastNotificationSchema

  const partners = await fetchAllPartners(req.scope)
  const targetIds = selectBroadcastPartnerIds(partners, {
    partner_ids: body.partner_ids,
    status: body.status,
  })

  const results: BroadcastResult[] = await Promise.all(
    targetIds.map(async (partner_id) => {
      const ok = await createPartnerNotification(req.scope, {
        partner_id,
        title: body.title,
        description: body.description ?? null,
        url: body.url ?? null,
        channel: body.channel,
        trigger_type: body.trigger_type ?? "admin.broadcast",
        resource_type: body.resource_type ?? "broadcast",
        resource_id: body.resource_id ?? null,
        data: body.data,
      })
      return { partner_id, ok }
    })
  )

  const summary = summarizeBroadcast(results)

  return res.status(200).json({
    broadcast: summary,
    partner_ids: targetIds,
  })
}
