import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { DESIGN_MODULE } from "../../../modules/designs"
import type { MoodboardOwner } from "../../../modules/designs/lib/moodboard-ownership"

/**
 * Save a scene to ONE owner's board (#2017).
 *
 * This replaces writing `design.moodboard`, which was a single column an admin
 * and a partner both wrote through. Last write won, silently, with a 200.
 *
 * Get-or-create: a party's first save mints their board. Creation is implicit
 * HERE and explicit in the UI — the route is only reached by someone who has
 * drawn something and pressed save, and refusing that because no row exists
 * yet would be a worse answer than making one.
 */

export type SaveDesignMoodboardInput = {
  designId: string
  owner: MoodboardOwner
  scene: unknown
  title?: string | null
  thumbnail_url?: string | null
}

const saveBoardStep = createStep(
  "save-design-moodboard",
  async (input: SaveDesignMoodboardInput, { container }) => {
    const service: any = container.resolve(DESIGN_MODULE)

    const selector =
      input.owner.type === "core"
        ? { design_id: input.designId, owner_type: "core" }
        : {
            design_id: input.designId,
            owner_type: "partner",
            partner_id: input.owner.partnerId,
          }

    const existing = (await service.listDesignMoodboards(selector)) as any[]
    const row = existing?.[0]

    const data: Record<string, any> = { scene: input.scene }
    if (input.title !== undefined) data.title = input.title
    if (input.thumbnail_url !== undefined) data.thumbnail_url = input.thumbnail_url

    if (row) {
      /**
       * The prior scene is captured for compensation. A board is somebody's
       * work; a rolled-back save that left the new scene in place would be the
       * clobber this entity exists to prevent, arriving by a different door.
       */
      const prior = {
        scene: row.scene,
        title: row.title,
        thumbnail_url: row.thumbnail_url,
      }
      await service.updateDesignMoodboards({ selector: { id: row.id }, data })
      const updated = await service.retrieveDesignMoodboard(row.id)
      return new StepResponse(updated, { id: row.id, prior, created: false })
    }

    const created = await service.createDesignMoodboards({
      ...data,
      owner_type: input.owner.type,
      partner_id: input.owner.type === "partner" ? input.owner.partnerId : null,
      design_id: input.designId,
    })
    const board = Array.isArray(created) ? created[0] : created
    if (!board?.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Could not create a moodboard for design ${input.designId}`
      )
    }
    return new StepResponse(board, { id: board.id, prior: null, created: true })
  },
  async (
    comp: { id: string; prior: any; created: boolean } | null,
    { container }
  ) => {
    if (!comp?.id) return
    const service: any = container.resolve(DESIGN_MODULE)
    if (comp.created) {
      await service.softDeleteDesignMoodboards(comp.id)
      return
    }
    await service.updateDesignMoodboards({
      selector: { id: comp.id },
      data: comp.prior,
    })
  }
)

export const saveDesignMoodboardWorkflow = createWorkflow(
  "save-design-moodboard",
  (input: SaveDesignMoodboardInput) => {
    const board = saveBoardStep(input)
    return new WorkflowResponse({ moodboard: board })
  }
)

export default saveDesignMoodboardWorkflow
