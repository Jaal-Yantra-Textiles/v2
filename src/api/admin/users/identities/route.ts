import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ListIdentitiesQuery } from "./validators"
import { listUserAuthIdentitiesWorkflow } from "../../../../workflows/users/list-auth-identities"

export const GET = async (
  req: MedusaRequest<ListIdentitiesQuery>,
  res: MedusaResponse
) => {
  // req.validatedQuery will be set by middleware
  const { email } = req.validatedQuery as ListIdentitiesQuery

  const { result, errors } = await listUserAuthIdentitiesWorkflow(req.scope).run({
    input: { email },
  })

  if (errors?.length) {
    // Let global error handler process
    throw errors[0].error || new Error("Failed to list auth identities")
  }

  // result is the provider identities array from the step
  return res.status(200).json({ identities: result })
}
