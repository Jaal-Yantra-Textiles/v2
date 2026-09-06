import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolveGraph } from "../../../../../lib/graph/registry"

/**
 * GET /admin/graph/:spine/:id
 *
 * One entity's neighbours as nodes and edges, for any registered spine.
 *
 * This replaces the design-specific `GET /admin/designs/:id/graph` prototype.
 * The resolver lives in `src/lib/graph` so this route and the MCP
 * `get_entity_neighbours` tool share one implementation rather than growing
 * two that drift — the failure mode this codebase has hit repeatedly whenever
 * the same logic acquired a second home.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const graph = await resolveGraph(req.scope, req.params.spine, req.params.id)
  res.json({ graph })
}
