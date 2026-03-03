import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { INBOUND_EMAIL_MODULE } from "../../../../modules/inbound_emails"

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const service = req.scope.resolve(INBOUND_EMAIL_MODULE) as any

  const inbound_email = await service.retrieveInboundEmail(id).catch(() => null)

  if (!inbound_email) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inbound email ${id} not found`)
  }

  res.status(200).json({ inbound_email })
}
