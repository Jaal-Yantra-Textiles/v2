import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPartnerWebsite } from "../../helpers"
import { updateWebsiteWorkflow } from "../../../../../workflows/website/update-website"
import { WebsiteTheme } from "./validators"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { website } = await getPartnerWebsite(
    req.auth_context,
    req.scope
  )

  // Read from dedicated theme column, fall back to legacy metadata.theme
  res.json({ theme: website.theme || website.metadata?.theme || {} })
}

export const PUT = async (
  req: AuthenticatedMedusaRequest<WebsiteTheme>,
  res: MedusaResponse
) => {
  const { website } = await getPartnerWebsite(
    req.auth_context,
    req.scope
  )

  const theme = req.validatedBody as WebsiteTheme

  const { result, errors } = await updateWebsiteWorkflow(req.scope).run({
    input: {
      id: website.id,
      theme,
    },
  })

  if (errors.length > 0) {
    throw errors[0]
  }

  res.json({ theme })
}
