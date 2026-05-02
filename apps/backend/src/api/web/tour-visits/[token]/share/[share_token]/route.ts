import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../../../../../../modules/forms"
import FormsService from "../../../../../../modules/forms/service"

type Share = { token: string; mode: "read"; created_at: string }

/**
 * DELETE /web/tour-visits/:token/share/:share_token
 *
 * Owner-only. Removes a previously-minted sibling share token from
 * `metadata.shares[]` so the partner who held that URL loses access.
 * Idempotent — DELETE-ing an unknown share_token returns 200 with the
 * current share list (so the wizard's UI can rely on a single shape).
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const token = req.params.token
  const shareToken = req.params.share_token

  if (!token || token.length < 16) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Invalid visit token")
  }
  if (!shareToken) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing share_token")
  }

  const forms: FormsService = req.scope.resolve(FORMS_MODULE)
  const responses = await forms.listFormResponses(
    { verification_code: token },
    { take: 1 }
  )
  const response = responses?.[0]
  if (!response) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Only the original recipient can manage share links."
    )
  }

  const existing: Share[] = Array.isArray((response.metadata as any)?.shares)
    ? (response.metadata as any).shares
    : []
  const next = existing.filter((s) => s.token !== shareToken)

  await (forms as any).updateFormResponses({
    id: response.id,
    metadata: {
      ...((response.metadata as any) || {}),
      shares: next,
    },
  })

  res.status(200).json({
    shares: next.map((s) => ({
      token: s.token,
      mode: s.mode,
      created_at: s.created_at,
    })),
  })
}
