import { MedusaError } from "@medusajs/framework/utils"
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
  prev_metadata: Record<string, any> | null
}

/**
 * Append the media to the run (metadata + activity note) and gate the run's
 * validity up front, so a bad id or a cancelled run fails the whole workflow
 * before anything is written.
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

    const existingMeta = (run.metadata as Record<string, any>) || {}
    const existingMedia: any[] = Array.isArray(existingMeta.attached_media)
      ? existingMeta.attached_media
      : []

    const attachment = {
      url: input.media_url,
      mime_type: input.media_mime_type ?? null,
      filename: input.filename ?? null,
      message_id: input.message_id ?? null,
      conversation_id: input.conversation_id ?? null,
      attached_by: "admin",
      attached_at: new Date().toISOString(),
    }

    await service.updateProductionRuns({
      id: run.id,
      metadata: {
        ...existingMeta,
        attached_media: [...existingMedia, attachment],
      },
    })

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
      { id: run.id, prev_metadata: run.metadata ?? null }
    )
  },
  async (comp: RunAttachComp, { container }) => {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    await service.updateProductionRuns({
      id: comp.id,
      metadata: comp.prev_metadata,
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