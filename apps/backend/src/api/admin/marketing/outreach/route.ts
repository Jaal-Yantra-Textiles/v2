/**
 * GET  /admin/marketing/outreach   — list hand-crafted outbound (Winbacks/Exec)
 * POST /admin/marketing/outreach   — log a new outreach row
 *
 * The marketing-outreach table is a low-volume CRM (manual exec/winback sends),
 * so the list path fetches the rows newest-first and filters/paginates in-app
 * via the pure `filterAndPaginateOutreach` helper (PR-4b). Filtering the FULL
 * set before slicing keeps `count` the authoritative total-matched — the
 * recurring `q`/pagination regression from memory #484.
 *
 * No middleware: query + body are parsed manually with the route validators so
 * the `/admin/marketing` matcher stays off the shared middlewares list (mirrors
 * the PR-3c read routes) and undeclared query params never 400 (#508).
 */

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { MARKETING_MODULE } from "../../../../modules/marketing"
import { filterAndPaginateOutreach } from "../../../../modules/marketing/outreach-list-lib"
import { logOutreachWorkflow } from "../../../../workflows/marketing/log-outreach"
import {
  createOutreachBodySchema,
  listOutreachQuerySchema,
} from "./validators"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const parsed = listOutreachQuerySchema.safeParse(req.query ?? {})
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid query" })
    return
  }
  const opts = parsed.data

  const service = req.scope.resolve(MARKETING_MODULE) as any

  // Pull the full set newest-first; the pure helper does the filter+paginate.
  const rows = await service.listMarketingOutreaches(
    {},
    { order: { created_at: "DESC" } }
  )

  const result = filterAndPaginateOutreach((rows as any[]) ?? [], opts)

  res.status(200).json({
    outreach: result.items,
    count: result.count,
    offset: result.offset,
    limit: result.limit,
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const parsed = createOutreachBodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" })
    return
  }

  const { result } = await logOutreachWorkflow(req.scope).run({
    input: parsed.data,
  })

  res.status(201).json({ outreach: result })
}
