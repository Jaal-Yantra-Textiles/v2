import { MedusaContainer } from "@medusajs/framework/types"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import { ingestFaireOrdersBulkWorkflow } from "../workflows/ingest-faire-orders-bulk"

/**
 * Scheduled pull of new Faire orders. Runs the bulk order-ingestion workflow
 * (a long-running background workflow) so new wholesale orders placed on Faire
 * are mirrored into Medusa without a seller having to trigger it manually.
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
  schedule: "*/30 * * * *", // every 30 minutes
}
