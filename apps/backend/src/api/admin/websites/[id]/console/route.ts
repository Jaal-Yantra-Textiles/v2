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

  const { website, binding, bindings, candidates } =
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

  // Resolve the synced site row (if any) for every matched property so the
  // UI can list all GSC properties available for this domain, not just the
  // primary one.
  const socials = req.scope.resolve(SOCIALS_MODULE) as any
  const properties = await Promise.all(
    bindings.map(async (b) => {
      const [row] = await socials.listGoogleSearchConsoleSites(
        { platform_id: b.platform_id, site_url: b.resource_id },
        { take: 1 }
      )
      return {
        resource_id: b.resource_id,
        matched_via: b.matched_via,
        platform_id: b.platform_id,
        is_primary: b.resource_id === binding.resource_id,
        synced: !!row,
        last_synced_at: row?.last_synced_at ?? null,
      }
    })
  )

  // `site` retained for backward compatibility — the primary property's row.
  const primary = properties.find((p) => p.is_primary)
  const [site] = primary?.synced
    ? await socials.listGoogleSearchConsoleSites(
        { platform_id: binding.platform_id, site_url: binding.resource_id },
        { take: 1 }
      )
    : [null]

  res.status(200).json({
    website,
    bound: true,
    binding,
    properties,
    site: site || null,
    candidates,
  })
}
