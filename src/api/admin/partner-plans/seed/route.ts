import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { seedPartnerPlansWorkflow } from "../../../../workflows/partner-subscription/seed-plans"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result, errors } = await seedPartnerPlansWorkflow(req.scope).run({
    input: {},
  })

  if (errors.length > 0) {
    throw errors[0]
  }

  res.json(result)
}
