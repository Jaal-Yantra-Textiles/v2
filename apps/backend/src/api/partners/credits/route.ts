import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import PartnerCreditLink from "../../../links/partner-credit-link"
import { foldPartnerCredits } from "../../../modules/internal_payments/lib/fold-credits"
import { getPartnerFromAuthContext } from "../helpers"

/**
 * GET /partners/credits — what this partner already holds (#1712).
 *
 * 🔴 The partner-facing half. hrhandloom holds INR 1,380 they were paid beyond
 * any payout, and until this route existed the only record of it was a chat
 * transcript — invisible to the person whose money it is.
 *
 * ⚠️ Scoped to the AUTHENTICATED partner, never to an id in the request. The
 * callee must refuse: a route that trusts a caller-supplied partner id is how
 * every storefront rendered every other partner's quote. There is deliberately
 * no way to ask this route about somebody else.
 *
 * 🔑 READ ONLY. A partner may see a credit; only an admin may create or apply
 * one. Whether money already given discharges the next payout is a decision the
 * ledger refuses to infer, and it is not a partner's to assert either.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no partner found"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({
    entity: PartnerCreditLink.entryPoint,
    fields: ["partner_credit.*"],
    filters: { partner_id: partner.id },
  })

  const credits = (data || [])
    .map((row: any) => row?.partner_credit)
    .filter(Boolean)

  /**
   * Reported beside what is owed, never subtracted from it — the same rule
   * `recorded_against_open` follows. A partner seeing "you hold 1,380" next to
   * "17,760 outstanding" can ask about it; a silently reduced total tells them
   * nothing and looks like an underpayment.
   *
   * Same shared fold as the admin route, deliberately.
   */
  return res.json({ credits, ...foldPartnerCredits(credits) })
}
