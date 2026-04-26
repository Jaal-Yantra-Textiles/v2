import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncInboundEmailsWorkflow } from "../../../../workflows/inbound-emails/sync-inbound-emails"
import { SyncInboundEmailsBody } from "../validators"

export const POST = async (
  req: MedusaRequest<SyncInboundEmailsBody>,
  res: MedusaResponse
) => {
  const body = (req.validatedBody || req.body) as SyncInboundEmailsBody
  const count = body?.count || 50

  const { result } = await syncInboundEmailsWorkflow(req.scope).run({
    input: { count },
  })

  return res.status(200).json(result)
}
