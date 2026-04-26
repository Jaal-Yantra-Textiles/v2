import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPartnerWebsite } from "../../helpers"
import { updateWebsiteWorkflow } from "../../../../../workflows/website/update-website"
import { WebsiteTheme } from "./validators"

/**
 * Deep merge two objects — incoming values override existing,
 * but sections not present in incoming are preserved.
 */
function deepMergeTheme(
  existing: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const result = { ...existing }

  for (const key of Object.keys(incoming)) {
    const existingVal = existing[key]
    const incomingVal = incoming[key]

    if (
      incomingVal &&
      typeof incomingVal === "object" &&
      !Array.isArray(incomingVal) &&
      existingVal &&
      typeof existingVal === "object" &&
      !Array.isArray(existingVal)
    ) {
      // Merge nested objects (e.g. hero, colors, animations)
      result[key] = { ...existingVal, ...incomingVal }
    } else {
      // Primitives, arrays, or null — take incoming value
      result[key] = incomingVal
    }
  }

  return result
}

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

  const incoming = req.validatedBody as WebsiteTheme
  const existing = website.theme || website.metadata?.theme || {}

  // Deep merge: preserves sections not sent by the frontend
  const merged = deepMergeTheme(existing, incoming)

  const { result, errors } = await updateWebsiteWorkflow(req.scope).run({
    input: {
      id: website.id,
      theme: merged,
    },
  })

  if (errors.length > 0) {
    throw errors[0]
  }

  res.json({ theme: merged })
}
