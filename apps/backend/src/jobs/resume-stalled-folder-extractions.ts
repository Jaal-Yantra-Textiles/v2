import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import type { IWorkflowEngineService } from "@medusajs/framework/types"

import { MEDIA_MODULE } from "../modules/media"
import {
  textileFolderExtractionMedusaWorkflow,
  textileFolderExtractionWorkflowId,
  waitConfirmationTextileFolderExtractionStepId,
  FolderExtractionProgress,
} from "../workflows/ai/textile-folder-extraction"
import {
  folderExtractionLiveness,
  pendingFolderExtractionMedia,
} from "../workflows/ai/lib/folder-extraction-resume"

/**
 * Finish folder extractions that a deploy killed mid-loop (#1742).
 *
 * ## Why a job and not a workflow retry
 *
 * `processFolderMediaSequentiallyStep` is one step holding a `for` loop with
 * `await sleep()` in it. At the measured production pace — ~3.2 min per photo,
 * because the vision call costs ~2.2 min on top of the 60 s interval — a
 * 62-image folder is a **3.3-hour** run inside a single Node process. There
 * were six deploys on 2026-09-02 alone. A run that long does not survive, and
 * Medusa cannot rescue it: the step is `async, backgroundExecution`, so the
 * engine waits for a callback from a process that no longer exists. All five
 * `textile-folder-extraction` executions ever started on production are still
 * sitting in `invoking`.
 *
 * Retrying the workflow is therefore not the fix; noticing and starting a fresh
 * scoped run is. That is what this does, and it is only safe because the
 * work-list is derived from state — images with no `textile_analysis` row —
 * so a resume can never redo what is already done.
 *
 * ## What it deliberately does NOT do
 *
 * 🔴 It does not resume a run that merely LOOKS slow. The threshold is three
 * intervals of silence with a ten-minute floor, and progress is written after
 * every single item, so a live run cannot trip it. Two loops over one folder
 * would double the provider rate the pacing exists to respect and leave a
 * duplicate analysis row for every image — `link.create` is not idempotent.
 *
 * 🔴 It does not resume forever. `resume_attempts` is capped the way
 * `process-email-queue` caps `MAX_ATTEMPTS`: a folder whose images fail for a
 * reason that will not change must stop costing vision calls, and be left for a
 * human to look at. A person pressing Resume in the admin is never blocked by
 * the count — they can see the errors and are making the call.
 *
 * 🔴 It never widens scope. A folder extraction covers the images that were in
 * the folder; images added afterwards are a new decision by whoever added them.
 * The resume asks only for what is outstanding, which is the same list the
 * status route reports.
 */

/** Stop auto-resuming a folder after this many attempts. */
export const MAX_RESUME_ATTEMPTS = 3

/** Never resume more than this many folders in one pass. */
const MAX_FOLDERS_PER_RUN = 5

export default async function resumeStalledFolderExtractions(
  container: MedusaContainer
) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const mediaService: any = container.resolve(MEDIA_MODULE)

  let folders: any[] = []
  try {
    folders = (await mediaService.listFolders({}, { take: 1000 })) || []
  } catch (e: any) {
    logger.error(`[resume-folder-extraction] Could not list folders: ${e?.message}`)
    return
  }

  /**
   * ⚠️ Filtered in memory. `folder_extraction` lives inside `metadata`, a JSON
   * bag, and the module service cannot filter on a subkey — asking it to would
   * silently return every folder, which is the shape that turns a scoped sweep
   * into an unscoped one.
   */
  const candidates = folders
    .map((folder: any) => ({
      folder,
      progress: (folder?.metadata?.folder_extraction as FolderExtractionProgress) || null,
    }))
    .filter(({ progress }) => progress?.status === "running")
    .map((row) => ({ ...row, liveness: folderExtractionLiveness(row.progress) }))
    .filter(({ liveness }) => liveness.stalled)

  if (!candidates.length) {
    logger.info("[resume-folder-extraction] No stalled folder extractions")
    return
  }

  logger.info(
    `[resume-folder-extraction] ${candidates.length} stalled folder extraction(s) found`
  )

  let resumed = 0

  for (const { folder, progress, liveness } of candidates) {
    if (resumed >= MAX_FOLDERS_PER_RUN) {
      /**
       * 🔑 Named, not silent. A cap that trims the list without saying so reads
       * as "everything was handled" on the next pass.
       */
      logger.info(
        `[resume-folder-extraction] Cap of ${MAX_FOLDERS_PER_RUN} reached — ${
          candidates.length - resumed
        } stalled folder(s) left for the next run`
      )
      break
    }

    const attempts = Number(progress?.resume_attempts ?? 0) || 0
    if (attempts >= MAX_RESUME_ATTEMPTS) {
      logger.warn(
        `[resume-folder-extraction] Folder ${folder.id} has been resumed ${attempts} time(s) and is still stalling — leaving it for a human`
      )
      continue
    }

    try {
      const { pending_media_ids, all_media_ids } = await pendingFolderExtractionMedia(
        container,
        folder.id
      )

      if (!pending_media_ids.length) {
        /**
         * Every image was analysed — the run died after its last item but
         * before `finalizeFolderExtractionStep`. Nothing to extract; just stop
         * the folder claiming to be running, so the admin strip stops spinning
         * and this sweep stops finding it.
         */
        await mediaService.updateFolders({
          selector: { id: folder.id },
          data: {
            metadata: {
              ...(folder.metadata || {}),
              folder_extraction: {
                ...(progress || {}),
                status: "completed",
                updated_at: new Date().toISOString(),
                finished_at: new Date().toISOString(),
              },
            },
          },
        })
        logger.info(
          `[resume-folder-extraction] Folder ${folder.id} was already complete — marked finished`
        )
        continue
      }

      const { transaction } = await textileFolderExtractionMedusaWorkflow(container).run({
        input: {
          folder_id: folder.id,
          media_ids: pending_media_ids,
          scope: "pending",
          persist: true,
          interval_ms: progress?.interval_ms,
        },
      })

      const workflowEngineService: IWorkflowEngineService = container.resolve(
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

      resumed++
      logger.info(
        `[resume-folder-extraction] Folder ${folder.id} (${folder.name}) silent for ${Math.round(
          (liveness.silent_for_ms ?? 0) / 60000
        )} min — resumed ${pending_media_ids.length} of ${all_media_ids.length} image(s), attempt ${
          attempts + 1
        }/${MAX_RESUME_ATTEMPTS}, tx ${transaction.transactionId}`
      )
    } catch (e: any) {
      logger.error(
        `[resume-folder-extraction] Failed to resume folder ${folder.id}: ${e?.message}`
      )
    }
  }
}

export const config = {
  name: "resume-stalled-folder-extractions",
  /**
   * Every 30 minutes. A stalled run is discovered within roughly one deploy's
   * worth of time, and the threshold (three intervals, ten-minute floor) is
   * well inside that — so nothing live is ever caught by it.
   */
  schedule: "*/30 * * * *",
}
