import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  acceptProductionRunWorkflow,
} from "../../../../../workflows/production-runs/accept-production-run"

export async function POST(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  const id = req.params.id

  const { result, errors } = await acceptProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      partner_id: partnerId,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to accept production run: ${errors
          .map((e: any) => e?.error?.message || String(e))
          .join(", ")}`
      )
    )
  }

  return res.status(200).json({ result })
}
