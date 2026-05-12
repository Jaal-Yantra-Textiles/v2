import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveSearchConsoleBindingForWebsite } from "../../../../../../lib/search-console-resolver"
import { syncSearchConsoleWorkflow } from "../../../../../../workflows/google-search-console/sync-search-console"

type SyncBody = {
  window_days?: number
  row_limit?: number
  dimensions?: Array<
    "date" | "query" | "page" | "country" | "device" | "searchAppearance"
  >
}

/**
 * POST /admin/websites/:id/console/sync
 *
 * Triggers a Search Console sync scoped to this website's bound property.
 * Resolves the GSC binding via the same matcher as GET /console — so the
 * operator never has to remember which platform the property is bound on.
 */
export const POST = async (req: MedusaRequest<SyncBody>, res: MedusaResponse) => {
  const websiteId = req.params.id
  const body = (req.body || {}) as SyncBody

  const { website, binding } = await resolveSearchConsoleBindingForWebsite(
    req.scope,
    websiteId
  )
  if (!website) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Website ${websiteId} not found`
    )
  }
  if (!binding) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `No Search Console property is bound for ${website.domain}. Bind one under Settings → External Platforms.`
    )
  }

  const { result } = await syncSearchConsoleWorkflow(req.scope).run({
    input: {
      platform_id: binding.platform_id,
      site_url: binding.resource_id,
      window_days: body.window_days,
      row_limit: body.row_limit,
      dimensions: body.dimensions,
    },
  })

  res.status(200).json({ website, binding, result })
}
