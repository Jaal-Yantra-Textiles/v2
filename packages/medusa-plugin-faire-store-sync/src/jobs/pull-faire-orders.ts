import { MedusaContainer } from "@medusajs/framework/types"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import { ingestFaireOrdersBulkWorkflow } from "../workflows/ingest-faire-orders-bulk"

/**
 * Scheduled incremental pull of Faire orders.
 *
 * Faire is POLLING, not webhooks — there is no inbound delivery. This job runs
 * the bulk order-ingestion workflow, which fetches only orders changed since
 * the persisted `last_order_sync_at` high-water mark (cursor-based). Cadence is
 * every 5 minutes (Faire's own WooCommerce plugin polls on a similar interval).
 *
 * Disable by setting FAIRE_AUTO_INGEST_ORDERS=false.
 */
export default async function pullFaireOrdersJob(container: MedusaContainer) {
  if (process.env.FAIRE_AUTO_INGEST_ORDERS === "false") return

  const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
  const account = await service.getActiveAccount()
  if (!account) return

  try {
    await ingestFaireOrdersBulkWorkflow(container).run({ input: {} })
  } catch (err: any) {
    console.error("[faire-sync] scheduled order pull failed:", err.message)
  }
}

export const config = {
  name: "faire-pull-orders",
  schedule: "*/5 * * * *", // every 5 minutes (polling model)
}
