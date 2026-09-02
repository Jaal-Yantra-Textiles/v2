/**
 * Retry the media files that FAILED a previous folder-wide extraction.
 *
 *   POST /admin/medias/folder/:id/extract-features/retry
 *
 * Reads the failed media ids recorded in `folder.metadata.folder_extraction.errors`
 * and re-runs the folder extraction workflow scoped to just those files
 * (`media_ids`), auto-confirming so processing starts immediately — one call,
 * no separate confirm step.
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

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const folder_id = req.params.id

  const mediaService = req.scope.resolve(MEDIA_MODULE) as MediaService
  const folder = await mediaService.retrieveFolder(folder_id).catch(() => null)
  if (!folder) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Folder not found: ${folder_id}`)
  }

  const progress = (folder.metadata?.folder_extraction as FolderExtractionProgress) || null
  const failedMediaIds = (progress?.errors ?? [])
    .map((e) => e?.media_id)
    .filter(Boolean)

  if (!failedMediaIds.length) {
    return res.json({
      message: "No failed extractions to retry.",
      folder_id,
      retried: 0,
    })
  }

  // Re-run the folder extraction scoped to the failed files only.
  const { transaction } = await textileFolderExtractionMedusaWorkflow(req.scope).run({
    input: {
      folder_id,
      media_ids: failedMediaIds,
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
    `[FolderExtractFeatures/Retry] Retrying ${failedMediaIds.length} failed file(s) in folder ${folder_id}`
  )

  return res.status(202).json({
    message: `Retrying ${failedMediaIds.length} failed extraction(s).`,
    transaction_id: transaction.transactionId,
    folder_id,
    retried: failedMediaIds.length,
  })
}