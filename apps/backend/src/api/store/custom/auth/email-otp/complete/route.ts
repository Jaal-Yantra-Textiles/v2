import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { completeEmailOtpSignInWorkflow } from "../../../../../../workflows/email-otp/complete-email-otp-sign-in"

/**
 * POST /store/custom/auth/email-otp/complete
 *
 * Second half of the design studio's passwordless sign-in (#2543). Called with
 * the token `POST /auth/customer/email-otp { email, code }` returned — an
 * actorless registration token for a first-time buyer, or a customer token for
 * a returning one (`authenticate(..., { allowUnregistered: true })` takes
 * both). The workflow attaches/creates the customer account for the VERIFIED
 * email and adopts the buyer's guest studio designs. The client then calls
 * `POST /auth/token/refresh` for a token that carries the customer.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const authIdentityId = req.auth_context?.auth_identity_id
  if (!authIdentityId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Sign in with an email code first.")
  }

  const { result } = await completeEmailOtpSignInWorkflow(req.scope).run({
    input: { auth_identity_id: authIdentityId },
  })

  res.json({
    customer_id: result.customer_id,
    email: result.email,
    created_customer: result.created_customer,
    adopted_design_ids: result.adopted_design_ids,
  })
}
