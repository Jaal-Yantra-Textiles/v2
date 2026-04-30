/**
 * POST /partners/notifications/read
 *
 * Bumps `partner.metadata.notifications_last_seen_at` to now() so all
 * existing notifications become "read" from the bell's perspective.
 *
 * We track read state via a single per-partner timestamp (channel-level
 * last-read marker, like Slack/GitHub) instead of per-notification flags.
 * The standard Medusa notification entity has no `read_at` column and
 * adding one would mean shipping a migration against framework tables —
 * this approach gets the same UX without that risk.
 */

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  resolvePartnerForNotifications,
  setPartnerNotificationsLastSeen,
} from "../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const partner = await resolvePartnerForNotifications(
    req.auth_context,
    req.scope,
  )

  const ts = await setPartnerNotificationsLastSeen(partner.id, req.scope)

  return res.status(200).json({
    last_seen_at: ts,
    unread_count: 0,
  })
}
