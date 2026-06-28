/**
 * @file GET /admin/ai/platforms — AI External Platform discovery (category sweep).
 *
 * "Discovery, not declaration": sweeps every `category=ai` External Platform and
 * returns the configured catalog grouped by `metadata.role`. Any provider the
 * operator adds — including under a brand-new custom role — shows up here with no
 * code change. Powers the visual-flow AI op's role/platform picker and ops
 * visibility into what's wired.
 *
 * Query:
 *   - include_inactive=true  → include draft/inactive platforms (default: active only)
 *
 * Returns: { catalog: AiPlatformCatalogEntry[], by_role: Record<role, entries[]>, roles: string[] }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  sweepAiPlatformsByCategory,
  groupAiCatalogByRole,
} from "../../../../mastra/services/ai-platforms"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const includeInactive =
    String((req.query?.include_inactive as string) ?? "").toLowerCase() === "true"

  const catalog = await sweepAiPlatformsByCategory(req.scope as any, {
    includeInactive,
  })
  const byRole = groupAiCatalogByRole(catalog)

  res.json({
    catalog,
    by_role: byRole,
    roles: Object.keys(byRole).sort(),
  })
}
