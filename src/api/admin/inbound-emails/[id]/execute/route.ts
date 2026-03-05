import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { INBOUND_EMAIL_MODULE } from "../../../../../modules/inbound_emails"
import { getAction } from "../../../../../workflows/inbound-emails/actions"
import { ExecuteInboundEmailBody } from "../../validators"

// Ensure actions are registered
import "../../../../../workflows/inbound-emails/actions/create-inventory-order"

export const POST = async (
  req: MedusaRequest<ExecuteInboundEmailBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = (req.validatedBody || req.body) as ExecuteInboundEmailBody
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

  // Use existing extracted data or extract now
  let extractedData = email.extracted_data
  if (!extractedData || email.action_type !== body.action_type) {
    extractedData = await action.extract(email)
  }

  try {
    const actionResult = await action.execute(email, extractedData, body.params, req.scope)

    await service.updateInboundEmails({
      id,
      action_type: body.action_type,
      extracted_data: extractedData,
      action_result: actionResult,
      status: "processed",
      error_message: null,
    })

    res.status(200).json({
      inbound_email_id: id,
      action_type: body.action_type,
      action_result: actionResult,
    })
  } catch (err: any) {
    await service.updateInboundEmails({
      id,
      action_type: body.action_type,
      extracted_data: extractedData,
      error_message: err.message,
    })

    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Action execution failed: ${err.message}`
    )
  }
}
