import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { INBOUND_EMAIL_MODULE } from "../../../../../modules/inbound_emails"
import { getAction } from "../../../../../utils/inbound-email-actions"
import { ExtractInboundEmailBody } from "../../validators"

// Ensure actions are registered
import "../../../../../utils/inbound-email-actions/create-inventory-order"

export const POST = async (
  req: MedusaRequest<ExtractInboundEmailBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = (req.validatedBody || req.body) as ExtractInboundEmailBody
  const service = req.scope.resolve(INBOUND_EMAIL_MODULE) as any

  const email = await service.retrieveInboundEmail(id).catch(() => null)
  if (!email) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inbound email ${id} not found`)
  }

  const action = getAction(body.action_type)
  if (!action) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown action type: ${body.action_type}`
    )
  }

  const extractedData = await action.extract(email)

  await service.updateInboundEmails({
    id,
    action_type: body.action_type,
    extracted_data: extractedData,
    status: "action_pending",
  })

  res.status(200).json({
    inbound_email_id: id,
    action_type: body.action_type,
    extracted_data: extractedData,
  })
}
