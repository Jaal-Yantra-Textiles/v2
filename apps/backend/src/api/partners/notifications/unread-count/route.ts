/**
 * GET /partners/notifications/unread-count
 *
 * Single-count endpoint for the bell badge. Counts notifications with
 * `receiver_id = partner.id` and `created_at > partner.metadata.notifications_last_seen_at`.
 *
 * Cheap and cacheable — designed to be polled by the bell on an interval
 * (every 30–60s) without hammering the DB. Returns just the integer +
 * the last-seen timestamp so the client can short-circuit re-renders.
 */

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolvePartnerForNotifications } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const partner = await resolvePartnerForNotifications(
    req.auth_context,
    req.scope,
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { metadata } = await query.graph({
    entity: "notifications",
    // Minimal field selection — we only need the count from the metadata.
    fields: ["id"],
    filters: {
      receiver_id: partner.id,
      created_at: { $gt: partner.last_seen_at },
    },
    pagination: { skip: 0, take: 1 },
  })

  return res.status(200).json({
    unread_count: (metadata as any)?.count ?? 0,
    last_seen_at: partner.last_seen_at,
  })
}
