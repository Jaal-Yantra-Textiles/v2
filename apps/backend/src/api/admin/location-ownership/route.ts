import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOCATION_OWNERSHIP_MODULE } from "../../../modules/location_ownership"
import { resolveCoreLocationIds } from "../../../workflows/consumption-logs/lib/apply-to-inventory"
import { AdminPostLocationOwnershipReq } from "./validators"

/**
 * GET /admin/location-ownership
 *
 * Every recorded location ownership. Small by nature — one row per stock
 * location — so it returns the lot rather than paginating.
 *
 * 🔑 `location_ownership` is the ORIGINAL shape and is left exactly as it was —
 * the stock-location widget reads it and derives its own `inferring` flag from
 * the rows. Everything below is ADDITIVE, for callers that have only an id and
 * no way to turn it into an answer: an agent asking "is this ours?" cannot read
 * a bare row set, which is why there was no MCP tool for this (#2116).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(LOCATION_OWNERSHIP_MODULE)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const rows = (await service.listLocationOwnerships({}, { take: null })) ?? []

  /**
   * Reported through the SAME function the consumption gate calls. Recomputing
   * ownership from the rows here would be a second reader of one fact, free to
   * drift from the first — and the first one decides whether stock may move.
   */
  const { coreLocationIds, seeded } = await resolveCoreLocationIds(req.scope)

  const byLocation = new Map<string, any>()
  for (const r of rows as any[]) {
    if (r?.stock_location_id) {
      byLocation.set(String(r.stock_location_id), r)
    }
  }

  const { data: stockLocations } = await query.graph({
    entity: "stock_locations",
    fields: ["id", "name"],
  })

  const locations = ((stockLocations || []) as any[])
    .filter((l) => l?.id)
    .map((l) => {
      const row = byLocation.get(String(l.id))
      return {
        stock_location_id: String(l.id),
        // A bare id cannot answer "is this ours?" for a human or an agent, and
        // being unable to see the decision was the whole defect.
        name: l.name ?? null,
        is_core: coreLocationIds.has(String(l.id)),
        /**
         * 🔑 `false` here is NOT an unknown that might turn out to be ours. A
         * location with no row is treated as non-core on purpose — defaulting
         * an unknown to "ours" would deduct partner-held stock. This says which
         * of the two a `false` is.
         */
        recorded: Boolean(row),
        is_export_origin: row?.is_export_origin ?? null,
        note: row?.note ?? null,
      }
    })
    .sort(
      (a, b) =>
        Number(b.is_core) - Number(a.is_core) ||
        String(a.name).localeCompare(String(b.name))
    )

  res.json({
    location_ownership: rows,
    locations,
    core_location_ids: Array.from(coreLocationIds),
    /**
     * 🔴 Part of the answer, not decoration. With no rows at all the resolver
     * falls back to inferring ONE brand location, and "two locations are ours"
     * means something entirely different in that mode. A caller that cannot
     * tell recorded from inferred cannot know whether a missing row is a
     * decision or a gap.
     */
    source: seeded ? "recorded" : "inferred",
  })
}

/**
 * POST /admin/location-ownership
 *
 * Upsert one location's ownership. Whether a location is ours decides whether
 * consumption may be deducted from it at all, so this writes an explicit row
 * rather than toggling anything inferred.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { stock_location_id, is_core, is_export_origin, note } =
    req.validatedBody as AdminPostLocationOwnershipReq

  const service: any = req.scope.resolve(LOCATION_OWNERSHIP_MODULE)
  const [existing] = await service.listLocationOwnerships(
    { stock_location_id },
    { take: 1 }
  )

  const row = existing
    ? await service.updateLocationOwnerships({
        id: existing.id,
        is_core,
        // Omitted means "leave the stored answer alone"; an explicit null
        // clears it back to undecided. See the validator.
        ...(is_export_origin !== undefined ? { is_export_origin } : {}),
        ...(note !== undefined ? { note } : {}),
      })
    : await service.createLocationOwnerships({
        stock_location_id,
        is_core,
        is_export_origin: is_export_origin ?? null,
        note: note ?? null,
      })

  res.json({ location_ownership: row })
}
