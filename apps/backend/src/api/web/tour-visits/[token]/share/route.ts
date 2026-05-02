import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { randomBytes } from "crypto"
import { FORMS_MODULE } from "../../../../../modules/forms"
import FormsService from "../../../../../modules/forms/service"

/**
 * POST /web/tour-visits/:token/share
 *
 * Mints a read-only sibling token for the same FormResponse so a
 * traveller can share their itinerary with a partner / family member
 * without giving them the ability to edit. Sibling tokens accumulate in
 * `metadata.shares[]` so the customer can revoke individually later.
 *
 * Owner-only. Share tokens cannot mint further share tokens.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const token = req.params.token
  if (!token || token.length < 16) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Invalid visit token")
  }

  const forms: FormsService = req.scope.resolve(FORMS_MODULE)

  const responses = await forms.listFormResponses(
    { verification_code: token },
    { take: 1 }
  )
  const response = responses?.[0]
  if (!response) {
    // Either the token is invalid or it's a share token (which can't mint more).
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Only the original recipient can create share links."
    )
  }

  const existingShares: Array<{
    token: string
    mode: "read"
    created_at: string
  }> =
    Array.isArray((response.metadata as any)?.shares)
      ? (response.metadata as any).shares
      : []

  // Cap at 3 active shares to avoid token sprawl. If they want more, they
  // can revoke an old one (revocation lives in a future enhancement).
  if (existingShares.length >= 3) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "You already have 3 active share links — revoke one before minting a new one."
    )
  }

  const shareToken = randomBytes(32).toString("base64url")
  const next = {
    token: shareToken,
    mode: "read" as const,
    created_at: new Date().toISOString(),
  }

  await (forms as any).updateFormResponses({
    id: response.id,
    metadata: {
      ...((response.metadata as any) || {}),
      shares: [...existingShares, next],
    },
  })

  res.status(200).json({
    share: next,
    visit_path: `/tours/visit/${shareToken}`,
  })
}
