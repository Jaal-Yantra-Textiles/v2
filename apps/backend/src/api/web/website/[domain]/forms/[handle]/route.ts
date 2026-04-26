import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { WebSubmitFormResponse } from "./validators"
import { submitFormResponseWorkflow } from "../../../../../../workflows/forms/submit-form-response"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { domain, handle } = req.params

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: forms } = await query.graph({
    entity: "form",
    filters: {
      domain,
      handle,
      status: "published",
    },
    fields: ["*", "fields.*"],
    pagination: {
      take: 1,
    },
  })

  if (!forms?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Form '${handle}' not found for domain '${domain}'`
    )
  }

  const form = forms[0]

  res.status(200).json({
    form: {
      id: form.id,
      handle: form.handle,
      title: form.title,
      description: form.description,
      submit_label: form.submit_label,
      success_message: form.success_message,
      settings: (form as any).settings,
      fields: (form as any).fields || [],
    },
  })
}

export const POST = async (
  req: MedusaRequest<WebSubmitFormResponse>,
  res: MedusaResponse
) => {
  const { domain, handle } = req.params

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.socket as any)?.remoteAddress ||
    null

  const userAgent = (req.headers["user-agent"] as string) || null
  const referrer = (req.headers["referer"] as string) || req.validatedBody.referrer || null

  const { result } = await submitFormResponseWorkflow(req.scope).run({
    input: {
      domain,
      handle,
      email: req.validatedBody.email,
      data: req.validatedBody.data,
      page_url: req.validatedBody.page_url,
      referrer,
      ip,
      user_agent: userAgent,
      metadata: req.validatedBody.metadata,
    },
  })

  res.status(201).json({ response: result })
}
