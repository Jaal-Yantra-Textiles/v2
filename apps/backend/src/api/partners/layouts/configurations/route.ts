/**
 * @file Partner layout configurations list API (#338)
 * @description Lists the authenticated partner's layout configurations across
 *   all zones (personal + default). Backs the composer's
 *   `useLayoutConfigurations` / `useHasLayoutCustomizations` existence check.
 *   Partner-scoped mirror of `/admin/layouts/configurations`.
 * @module API/Partners/Layouts
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { PARTNER_UI_PREFS_MODULE } from "../../../../modules/partner-ui-prefs"

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

  const limit = Number.parseInt(String(req.query.limit ?? "100"), 10) || 100
  const offset = Number.parseInt(String(req.query.offset ?? "0"), 10) || 0

  const service: any = req.scope.resolve(PARTNER_UI_PREFS_MODULE)
  const [rows, count] = await service.listAndCountPartnerUiLayoutConfigurations(
    { partner_id: partner.id },
    { skip: offset, take: limit }
  )

  return res.status(200).json({
    layout_configurations: rows,
    count,
    offset,
    limit,
  })
}
