import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryFailedEmailWorkflow } from "../../../../../workflows/email/workflows/retry-failed-email"

interface RetryEmailRequest {
  notificationId: string
  to: string
  template: string
  data?: Record<string, any>
}

export const POST = async (
  req: MedusaRequest<RetryEmailRequest>, 
  res: MedusaResponse
) => {
  const { notificationId, to, template, data } = req.body

  if (!notificationId || !to || !template) {
    return res.status(400).json({
      error: "Missing required fields: notificationId, to, template"
    })
  }

  try {
    const { result, errors } = await retryFailedEmailWorkflow(req.scope).run({
      input: {
        to,
        template,
        data,
        originalNotificationId: notificationId
      },
      throwOnError: false
    })

    if (errors.length > 0) {
      return res.status(500).json({
        error: "Failed to retry email",
        details: errors
      })
    }

    return res.status(200).json({
      message: "Email retried successfully",
      result
    })
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    })
  }
}
