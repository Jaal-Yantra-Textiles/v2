import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../modules/faire-sync"
import FaireSyncService from "../../../../modules/faire-sync/service"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// GET /admin/faire/taxonomy?q=&limit=&ids= — taxonomy types from Faire's
// /products/types. Faire returns the full ~3k list unpaginated with no
// server-side search, so the service caches the whole list and we filter/slice
// HERE. The browser sends `q` and gets back only matches, instead of pulling
// every row to filter client-side. `ids` resolves specific `tt_…` rows (used to
// show the name of an already-pinned category without loading the whole list).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const q = String((req.query.q as string) ?? "").trim().toLowerCase()
  const idsParam = String((req.query.ids as string) ?? "").trim()
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT)

  const all = await service.getTaxonomyTypes()

  if (idsParam) {
    const ids = new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))
    const rows = all.filter((t) => ids.has(t.id))
    res.json({ taxonomy: rows, count: rows.length, total: all.length })
    return
  }

  const matched = q
    ? all.filter((t) => t.name.toLowerCase().includes(q))
    : all

  res.json({
    taxonomy: matched.slice(0, limit),
    count: matched.length,
    total: all.length,
  })
}
