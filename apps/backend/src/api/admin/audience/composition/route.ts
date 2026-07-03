import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { AUDIENCE_MODULE } from "../../../../modules/audience"

/**
 * GET /admin/audience/composition
 *
 * The "who's in here" view (#881 S1): aggregates the materialized audience_entry
 * rows into counts by source / tag / member_type, plus the group definitions.
 * Populate/refresh the entries with the `backfill-audience-entries` DP job.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const audienceService: any = req.scope.resolve(AUDIENCE_MODULE)

  const [entries, groups]: [any[], any[]] = await Promise.all([
    audienceService.listAudienceEntries({}, { take: 100000 }).catch(() => []),
    audienceService.listAudienceGroups({}).catch(() => []),
  ])

  const bySource: Record<string, number> = {}
  const byTag: Record<string, number> = {}
  const byMemberType: Record<string, number> = {}
  let mailable = 0
  for (const e of entries) {
    bySource[e.source || "unknown"] = (bySource[e.source || "unknown"] ?? 0) + 1
    byMemberType[e.member_type] = (byMemberType[e.member_type] ?? 0) + 1
    for (const t of e.tags || []) byTag[t] = (byTag[t] ?? 0) + 1
    if (e.mailable) mailable++
  }

  // Per-group mailable count (for the send-UI live count later).
  const groupCounts = groups.map((g: any) => {
    const inGroup = entries.filter((e) => (e.groups || []).includes(g.key))
    return {
      key: g.key,
      label: g.label,
      kind: g.kind,
      total: inGroup.length,
      mailable: inGroup.filter((e) => e.mailable).length,
    }
  })

  res.json({
    composition: {
      total: entries.length,
      mailable,
      by_source: bySource,
      by_tag: byTag,
      by_member_type: byMemberType,
    },
    groups: groupCounts,
    // Hint when the table is empty so the UI can prompt a backfill run.
    needs_backfill: entries.length === 0,
  })
}
