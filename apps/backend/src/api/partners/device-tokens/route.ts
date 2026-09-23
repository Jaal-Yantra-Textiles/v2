/**
 * @file Partner device-token registration — the push leg of the partner
 *        notification system.
 * @description The native partner apps (iOS: JYTPartner, Android: JYT
 *              Partner) register their push tokens here. The
 *              `notification-push` Module Provider reads them from the
 *              `partnerPush` module and fans notifications out over
 *              APNs/FCM.
 * @module API/Partners/DeviceTokens
 */

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { getPartnerFromAuthContext } from "../helpers"
import { PARTNER_PUSH_MODULE } from "../../../modules/partner-push"
import type PartnerPushService from "../../../modules/partner-push/service"
import type {
  RegisterDeviceTokenInput,
  UnregisterDeviceTokenInput,
} from "./validators"

/**
 * POST /partners/device-tokens
 *
 * Upserts (partner, token) — token rotation on reinstall/re-login re-posts
 * the same call and never duplicates rows.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<RegisterDeviceTokenInput>,
  res: MedusaResponse
) {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no actor ID"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner found for this user"
    )
  }

  const push: PartnerPushService = req.scope.resolve(PARTNER_PUSH_MODULE)
  const row = await push.registerToken({
    partner_id: partner.id,
    token: req.validatedBody.token,
    platform: req.validatedBody.platform,
    app_version: req.validatedBody.app_version ?? null,
  })

  res.json({ device_token: row })
}

/**
 * DELETE /partners/device-tokens
 *
 * Removes one token — the app calls this on logout so a signed-out device
 * stops receiving the partner's notifications.
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest<UnregisterDeviceTokenInput>,
  res: MedusaResponse
) {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no actor ID"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner found for this user"
    )
  }

  const push: PartnerPushService = req.scope.resolve(PARTNER_PUSH_MODULE)
  await push.unregisterToken(partner.id, req.validatedBody.token)

  res.json({ success: true })
}
