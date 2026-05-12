import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import {
  resolveSearchConsoleBindingForWebsite,
} from "../../../../../lib/search-console-resolver"

/**
 * GET /admin/websites/:id/console
 *
 * Returns the Search Console state for a website:
 *
 *   { website: {...}, bound: true, site: {...}, last_synced_at: ... }
 *   { website: {...}, bound: false, candidates: [...] }   // no GSC binding for this domain
 *   { website: null }                                     // website not found
 *
 * Frontend uses this single endpoint to decide whether to render the
 * data view or the "bind a property" empty state.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteId = req.params.id
  if (!websiteId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "website id is required"
    )
  }

  const { website, binding, candidates } =
    await resolveSearchConsoleBindingForWebsite(req.scope, websiteId)

  if (!website) {
    return res.status(404).json({ website: null })
  }

  if (!binding) {
    return res.status(200).json({
      website,
      bound: false,
      candidates,
    })
  }

  // We have a binding; look up the synced site row (if any).
  const socials = req.scope.resolve(SOCIALS_MODULE) as any
  const [site] = await socials.listGoogleSearchConsoleSites(
    { platform_id: binding.platform_id, site_url: binding.resource_id },
    { take: 1 }
  )

  res.status(200).json({
    website,
    bound: true,
    binding,
    site: site || null,
    candidates,
  })
}
