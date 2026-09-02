/**
 * Resume a folder-wide extraction — every image that still has no analysis.
 *
 *   POST /admin/medias/folder/:id/extract-features/retry
 *
 * ## What this used to do, and why it could not finish the job (#1742)
 *
 * It read `folder.metadata.folder_extraction.errors` and re-ran exactly those
 * files. On production that was **one** file out of the **44** outstanding: the
 * run had died mid-loop when a deploy replaced its ECS task, so 43 images were
 * never attempted at all — and an image nobody tried is not an error. No route
 * in the system could reach them.
 *
 * Worse, it then re-initialised progress with `total: 1`, overwriting the
 * "18 of 62 done, 1 failed" record with "0 of 1". The only place the
 * outstanding work was counted was the thing being overwritten.
 *
 * 🔑 The work-list now comes from state — images with no `textile_analysis`
 * row — which is the shape `backfillAllGeocodesWorkflow` has always used and
 * the reason running it twice is harmless. A file the run failed on and a file
 * the run never reached are the same thing to the work that remains.
 *
 * The URL keeps its name so existing callers and the admin bundle keep working.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import MediaService from "../../../../../../../modules/media/service"
import { MEDIA_MODULE } from "../../../../../../../modules/media"
import {
  textileFolderExtractionMedusaWorkflow,
  textileFolderExtractionWorkflowId,
  waitConfirmationTextileFolderExtractionStepId,
  FolderExtractionProgress,
} from "../../../../../../../workflows/ai/textile-folder-extraction"
import {
  folderExtractionLiveness,
  pendingFolderExtractionMedia,
} from "../../../../../../../workflows/ai/lib/folder-extraction-resume"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const folder_id = req.params.id

  const mediaService = req.scope.resolve(MEDIA_MODULE) as MediaService
  const folder = await mediaService.retrieveFolder(folder_id).catch(() => null)
  if (!folder) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Folder not found: ${folder_id}`)
  }

  const progress = (folder.metadata?.folder_extraction as FolderExtractionProgress) || null
  const { pending_media_ids, all_media_ids } = await pendingFolderExtractionMedia(
    req.scope,
    folder_id
  )

  if (!pending_media_ids.length) {
    return res.json({
      message: "Nothing to resume — every image in this folder already has an analysis.",
      folder_id,
      resumed: 0,
      pending_count: 0,
      folder_total: all_media_ids.length,
    })
  }

  /**
   * ⚠️ Refuse while a run is genuinely alive, and say which. Two loops over the
   * same folder would extract every pending image twice, in parallel, at double
   * the provider rate the pacing exists to respect — and `link.create` is not
   * idempotent, so each would leave its own duplicate analysis row.
   *
   * The test is liveness, not `status`: a `running` that has gone quiet past
   * the threshold is exactly the case this route exists for, so it must NOT be
   * treated as a run in progress.
   */
  const liveness = folderExtractionLiveness(progress)
  if (progress?.status === "running" && !liveness.stalled) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `A folder extraction is still running here — last progress ${
        liveness.silent_for_ms === null
          ? "unknown"
          : `${Math.round(liveness.silent_for_ms / 1000)}s ago`
      }, and it is only presumed stalled after ${Math.round(
        liveness.threshold_ms / 1000
      )}s of silence. Wait for it to finish or stall.`
    )
  }

  const { transaction } = await textileFolderExtractionMedusaWorkflow(req.scope).run({
    input: {
      folder_id,
      /**
       * Both, deliberately. `media_ids` pins the run to the list this request
       * measured and reported back, and `scope: "pending"` re-asks the question
       * at the moment processing starts — so anything analysed in between (a
       * single-image extraction, a concurrent resume that won the race) is
       * dropped rather than paid for twice.
       */
      media_ids: pending_media_ids,
      scope: "pending",
      persist: true,
      interval_ms: progress?.interval_ms,
    },
  })

  // Auto-confirm so processing starts immediately (one call for the caller).
  const workflowEngineService: IWorkflowEngineService = req.scope.resolve(
    Modules.WORKFLOW_ENGINE
  )
  await workflowEngineService.setStepSuccess({
    idempotencyKey: {
      action: TransactionHandlerType.INVOKE,
      transactionId: transaction.transactionId,
      stepId: waitConfirmationTextileFolderExtractionStepId,
      workflowId: textileFolderExtractionWorkflowId,
    },
    stepResponse: new StepResponse(true),
  })

  logger.info(
    `[FolderExtractFeatures/Resume] Resuming ${pending_media_ids.length} of ${all_media_ids.length} file(s) in folder ${folder_id}`
  )

  return res.status(202).json({
    message: `Resuming ${pending_media_ids.length} outstanding extraction(s).`,
    transaction_id: transaction.transactionId,
    folder_id,
    resumed: pending_media_ids.length,
    /** Kept for callers written against the old response. */
    retried: pending_media_ids.length,
    pending_count: pending_media_ids.length,
    folder_total: all_media_ids.length,
  })
}
