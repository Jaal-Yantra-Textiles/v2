import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ingestFaireOrdersBulkWorkflow } from "../../../../../workflows/ingest-faire-orders-bulk"

type IngestOrdersBody = {
  limit?: number
  // ISO timestamp; pass `null` to force a full backfill. Omit for incremental
  // (since last successful sync).
  updated_at_min?: string | null
}

// POST /admin/faire/ingest/orders — pull Faire orders and create Medusa orders
// for them. Faire is polled (no webhooks); runs as a long-running background
// workflow and returns a batch id the client can poll at
// GET /admin/faire/ingest/orders/:batchId.
export const POST = async (
  req: MedusaRequest<IngestOrdersBody>,
  res: MedusaResponse
) => {
  const limit = req.body?.limit
  if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "limit must be a positive number"
    )
  }

  const { result } = await ingestFaireOrdersBulkWorkflow(req.scope).run({
    input: { limit, updated_at_min: req.body?.updated_at_min },
  })

  res.status(202).json({ batch_id: (result as any).batch_id, status: "processing" })
}
