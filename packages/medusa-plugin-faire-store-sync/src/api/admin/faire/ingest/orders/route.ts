import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ingestFaireOrdersBulkWorkflow } from "../../../../../workflows/ingest-faire-orders-bulk"

type IngestOrdersBody = {
  limit?: number
}

// POST /admin/faire/ingest/orders — pull Faire orders and create Medusa orders
// for them. Runs as a long-running background workflow; returns a batch id the
// client can poll at GET /admin/faire/ingest/orders/:batchId.
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
    input: { limit },
  })

  res.status(202).json({ batch_id: (result as any).batch_id, status: "processing" })
}
