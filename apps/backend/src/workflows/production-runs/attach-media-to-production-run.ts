import { randomUUID } from "crypto"

import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { DESIGN_MODULE } from "../../modules/designs"
import type DesignService from "../../modules/designs/service"

export type AttachMediaToProductionRunInput = {
  production_run_id: string
  media_url: string
  media_mime_type?: string | null
  filename?: string | null
  message_id?: string | null
  conversation_id?: string | null
  actor_id?: string | null
}

type RunAttachComp = {
  id: string
  /**
   * The single attachment this step appended, identified by its own id. The
   * compensation removes exactly that entry rather than restoring the whole
   * metadata blob it saw beforehand — a wholesale restore reverts whatever any
   * concurrent writer put in `metadata` in the meantime, including keys that
   * have nothing to do with media.
   */
  attachment_id: string
}

/** One run's attach-media critical section. */
const runAttachLockKey = (runId: string) => `production-run-attach-media:${runId}`

/**
 * Append the media to the run (metadata + activity note) and gate the run's
 * validity up front, so a bad id or a cancelled run fails the whole workflow
 * before anything is written.
 *
 * `attached_media` lives inside the `metadata` JSON blob, so appending to it is
 * a read-modify-write of the WHOLE column: two attaches that interleave both
 * read the same array and the second write drops the first, silently. That is
 * the normal case, not an edge case — a partner sending two photos back to back
 * on WhatsApp produces exactly this. So the read, the append and the write all
 * happen inside the run's lock, re-reading the run FRESH inside it; the copy
 * fetched for validation above is already stale by then. (#1387)
 *
 * Same shape as `complete-production-run`, including throwing OUTSIDE the lock
 * so a rejected attach cannot hold the run locked behind a validation failure.
 */
const attachMediaToRunStep = createStep(
  "attach-media-to-run",
  async (input: AttachMediaToProductionRunInput, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)

    const run = (await service
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)) as any
    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${input.production_run_id} not found`
      )
    }
    if (run.status === "cancelled") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot attach media to a cancelled production run"
      )
    }

    const lockingService = container.resolve(Modules.LOCKING) as any

    const attachment = {
      // Identity for the compensation. Without it the only way to undo this
      // append is to restore the whole blob, which clobbers concurrent writes.
      id: randomUUID(),
      url: input.media_url,
      mime_type: input.media_mime_type ?? null,
      filename: input.filename ?? null,
      message_id: input.message_id ?? null,
      conversation_id: input.conversation_id ?? null,
      attached_by: "admin",
      attached_at: new Date().toISOString(),
    }

    let cancelledDuringLock = false

    await lockingService.execute(runAttachLockKey(run.id), async () => {
      // Re-read INSIDE the lock. The `run` above was fetched before we held
      // it, so its metadata may already be a lost update.
      const freshRun = (await service.retrieveProductionRun(run.id)) as any

      // Re-check against the fresh row: the run can be cancelled between the
      // validation above and acquiring the lock.
      if (freshRun.status === "cancelled") {
        cancelledDuringLock = true
        return
      }

      const existingMeta = (freshRun.metadata as Record<string, any>) || {}
      const existingMedia: any[] = Array.isArray(existingMeta.attached_media)
        ? existingMeta.attached_media
        : []

      await service.updateProductionRuns({
        id: freshRun.id,
        metadata: {
          ...existingMeta,
          attached_media: [...existingMedia, attachment],
        },
      })
    })

    // Thrown outside the lock — see the step's header.
    if (cancelledDuringLock) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot attach media to a cancelled production run"
      )
    }

    // Audit note — best-effort, never fails the attachment.
    try {
      await service.createProductionRunActivities({
        production_run_id: run.id,
        activity_type: "note",
        kind: "media_attached",
        actor_type: "admin",
        actor_id: input.actor_id ?? null,
        partner_id: run.partner_id ?? null,
        channel: input.message_id ? "whatsapp" : null,
        message_id: input.message_id ?? null,
        template_name: null,
        recipient: null,
        summary: `Media attached: ${input.filename || input.media_url.split("/").pop() || "file"}`,
        payload: {
          media_url: input.media_url,
          media_mime_type: input.media_mime_type ?? null,
          filename: input.filename ?? null,
          from_message_id: input.message_id ?? null,
          from_conversation_id: input.conversation_id ?? null,
          source: "messaging_inbox",
        },
        occurred_at: new Date(),
      } as any)
    } catch {
      // Best-effort audit
    }

    const updated = await service.retrieveProductionRun(run.id)

    return new StepResponse(
      { production_run: updated, design_id: run.design_id ?? null },
      { id: run.id, attachment_id: attachment.id }
    )
  },
  async (comp: RunAttachComp, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const lockingService = container.resolve(Modules.LOCKING) as any

    // Undo by REMOVING our own entry, under the same lock, from a fresh read.
    // Restoring the metadata we saw before the write would also revert any
    // other attach that landed in between — a compensation that loses someone
    // else's data is worse than the failure it is cleaning up after.
    await lockingService.execute(runAttachLockKey(comp.id), async () => {
      const freshRun = (await service
        .retrieveProductionRun(comp.id)
        .catch(() => null)) as any
      if (!freshRun) return

      const meta = (freshRun.metadata as Record<string, any>) || {}
      const media: any[] = Array.isArray(meta.attached_media)
        ? meta.attached_media
        : []

      await service.updateProductionRuns({
        id: comp.id,
        metadata: {
          ...meta,
          attached_media: media.filter((m: any) => m?.id !== comp.attachment_id),
        },
      })
    })
  }
)

type DesignAttachComp = {
  id: string | null
  prev_media_files: any[] | null
}

/**
 * Mirror the media onto the design's gallery. Deliberately best-effort and
 * non-failing: a retail-minted run has no `design_id`, and the run attachment
 * is the primary action, so a missing design is a skip, not an error.
 */
const attachMediaToDesignStep = createStep<
  { design_id: string | null; media_url: string },
  { design: any },
  DesignAttachComp
>(
  "attach-media-to-design",
  async (
    input,
    { container }
  ): Promise<StepResponse<{ design: any }, DesignAttachComp>> => {
    const skip = (): StepResponse<{ design: any }, DesignAttachComp> =>
      new StepResponse({ design: null }, { id: null, prev_media_files: null })

    if (!input.design_id) {
      return skip()
    }

    try {
      const service: DesignService = container.resolve(DESIGN_MODULE)
      const design = (await service
        .retrieveDesign(input.design_id)
        .catch(() => null)) as any
      if (!design) {
        return skip()
      }

      const existing: any[] = Array.isArray(design.media_files)
        ? design.media_files
        : []
      const seen = new Set<string>(
        existing.map((m) => m?.url).filter(Boolean)
      )
      if (seen.has(input.media_url)) {
        return new StepResponse(
          { design },
          { id: design.id, prev_media_files: design.media_files ?? null }
        )
      }

      const mergedMedia = [
        ...existing,
        { url: input.media_url, isThumbnail: false },
      ]
      await service.updateDesigns({
        id: design.id,
        media_files: mergedMedia,
      } as any)

      const updated = await service.retrieveDesign(design.id)
      return new StepResponse(
        { design: updated },
        { id: design.id, prev_media_files: design.media_files ?? null }
      )
    } catch {
      // Best-effort — the run attachment already succeeded.
      return skip()
    }
  },
  async (comp, { container }) => {
    if (!comp?.id) return
    const service: DesignService = container.resolve(DESIGN_MODULE)
    await service.updateDesigns({
      id: comp.id,
      media_files: comp.prev_media_files,
    } as any)
  }
)

export const attachMediaToProductionRunWorkflow = createWorkflow(
  "attach-media-to-production-run",
  (input: AttachMediaToProductionRunInput) => {
    const runResult = attachMediaToRunStep(input)
    const designResult = attachMediaToDesignStep({
      design_id: runResult.design_id,
      media_url: input.media_url,
    })
    return new WorkflowResponse({
      production_run: runResult.production_run,
      design: designResult.design,
    })
  }
)

export default attachMediaToProductionRunWorkflow