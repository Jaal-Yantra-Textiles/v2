/**
 * @file Partner LayoutComposer configuration API (#338)
 * @description Per-zone read / upsert / reset of a partner's layout
 *   personalization (sidebar & page widget placement/visibility). The
 *   partner-scoped mirror of Medusa core's `/admin/layouts/:zone/configuration`,
 *   backing the LayoutComposer ported into partner-ui.
 * @module API/Partners/Layouts
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { PARTNER_UI_PREFS_MODULE } from "../../../../../modules/partner-ui-prefs"
import type { SetLayoutConfigurationInput } from "../../validators"

/**
 * GET /partners/layouts/:zone/configuration
 * Returns the partner's personal + default configurations for a zone (either
 * may be null), plus which scope is active. Shape matches what the composer's
 * `useLayoutConfiguration` hook reads.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const zone = req.params.zone
  const service: any = req.scope.resolve(PARTNER_UI_PREFS_MODULE)
  const { personal, default: defaultRow } = await service.getZoneConfigurations(
    partner.id,
    zone
  )

  // Personal wins over default for the current partner (matches the composer's
  // definedScope precedence). Falls back to "default" when only a default row
  // exists, and "personal" when neither does (the composer seeds from default).
  const active_scope = personal ? "personal" : defaultRow ? "default" : "personal"

  return res.status(200).json({
    personal_configuration: personal,
    default_configuration: defaultRow,
    active_scope,
  })
}

/**
 * POST /partners/layouts/:zone/configuration
 * Upserts the configuration for the given scope (`is_default` false → personal,
 * true → the partner-wide default). Mirrors the composer's `setPreference`.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<SetLayoutConfigurationInput>,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const zone = req.params.zone
  const { is_default = false, configuration } =
    req.validatedBody as SetLayoutConfigurationInput

  const service: any = req.scope.resolve(PARTNER_UI_PREFS_MODULE)
  const saved = await service.setZoneConfiguration({
    partner_id: partner.id,
    zone,
    is_default,
    configuration,
  })

  return res.status(200).json({ layout_configuration: saved })
}

/**
 * DELETE /partners/layouts/:zone/configuration
 * Removes the partner's personal override for the zone (resets to default).
 * The default row, if any, is left intact.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const zone = req.params.zone
  const service: any = req.scope.resolve(PARTNER_UI_PREFS_MODULE)
  const deleted = await service.deletePersonalZoneConfiguration(partner.id, zone)

  return res.status(200).json({ id: zone, object: "layout_configuration", deleted })
}
