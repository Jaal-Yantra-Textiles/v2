import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import createInvestorAdminWorkflow from "../../workflows/investor/create-investor-admin"
import { investorSchema } from "./validators"
import type { z } from "@medusajs/framework/zod"
import { refetchInvestor } from "./helpers"

type RequestBody = z.infer<typeof investorSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<RequestBody>,
  res: MedusaResponse
) => {
  if (req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Request already authenticated as an investor."
    )
  }

  const { admin, ...investorData } = investorSchema.parse(req.body)

  if (!investorData.handle) {
    investorData.handle = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  const authIdentityId = req.auth_context?.auth_identity_id
  if (!authIdentityId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Investor authentication required"
    )
  }

  const { result } = await createInvestorAdminWorkflow(req.scope).run({
    input: {
      investor: investorData,
      admin,
      authIdentityId,
    },
  })

  const investorWithAdmin = await refetchInvestor(result.createdInvestor.id, req.scope)

  res.json({ investor: investorWithAdmin })
}
