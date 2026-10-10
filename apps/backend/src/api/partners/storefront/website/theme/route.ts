import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPartnerWebsite, triggerStorefrontRevalidate } from "../../helpers"
import { updateWebsiteWorkflow } from "../../../../../workflows/website/update-website"
import { deepMergeTheme } from "./merge-theme"
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

  // Theme touches the root layout (branding, footer, navigation,
  // colours, every home section). Path-scoped revalidation isn't
  // enough — flush the whole app's data cache via paths:['/'].
  //
  // Awaited, not fire-and-forget: this hop is exactly where partner edits go
  // to die (a mismatched secret answers 401 forever, and the save still looked
  // green), so the partner is told whether their change is actually live. The
  // helper caps itself at 5s and never throws, so the worst case is a slower
  // save — not a failed one. The theme is already written at this point;
  // `revalidation` describes visibility, not persistence.
  const revalidation = await triggerStorefrontRevalidate(website, {
    paths: ["/"],
  })

  res.json({ theme: merged, revalidation })
}
