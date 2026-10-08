import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * #2377 S2 — the Inbox folder rail: every folder that holds email, with how
 * many emails it has and how many still need someone (received or
 * action_pending). Folders come from the data, so a new iCloud folder shows
 * up as soon as its first email is synced.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const rows = await pg("inbound_email")
    .whereNull("deleted_at")
    .select("folder")
    .count({ total: "*" })
    .select(pg.raw("count(*) filter (where status in ('received','action_pending')) as open"))
    .groupBy("folder")
    .orderBy("folder")

  res.status(200).json({
    folders: rows.map((r: any) => ({
      folder: r.folder,
      total: Number(r.total),
      open: Number(r.open),
    })),
  })
}
