/**
 * @file Admin view of a design's moodboards (#2017).
 *
 * GET  — the core board as `own`, every partner board as read-only `others`.
 * POST — save the scene to the CORE board.
 *
 * The admin used to save through the kitchen-sink design update
 * (`PUT /admin/designs/:id` with `{ moodboard }`), i.e. the same column the
 * partner wrote. That is the clobber this entity removes, so the admin gets a
 * board-scoped door of its own.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { resolveBoards } from "../../../../../modules/designs/lib/moodboard-ownership"
import { saveDesignMoodboardWorkflow } from "../../../../../workflows/designs/moodboard/save-design-moodboard"

const BOARD_FIELDS = [
  "id",
  "moodboard",
  "moodboards.id",
  "moodboards.owner_type",
  "moodboards.partner_id",
  "moodboards.title",
  "moodboards.scene",
  "moodboards.thumbnail_url",
  "moodboards.updated_at",
]

export async function GET(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
): Promise<void> {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "designs",
    filters: { id: req.params.id },
    fields: BOARD_FIELDS,
  })
  const design = data?.[0]
  res
    .status(200)
    .json(resolveBoards(design?.moodboards, design?.moodboard, { type: "core" }))
}

export async function POST(
  req: AuthenticatedMedusaRequest<{ moodboard?: unknown; scene?: unknown }> & {
    params: { id: string }
  },
  res: MedusaResponse
): Promise<void> {
  const body = (req.validatedBody ?? req.body ?? {}) as Record<string, unknown>
  // `moodboard` is what the admin dashboard has always sent; `scene` is the
  // entity's own name. Both accepted so the hook can move without a lockstep
  // deploy.
  const scene = body.scene ?? body.moodboard

  const { result, errors } = await saveDesignMoodboardWorkflow(req.scope).run({
    input: { designId: req.params.id, owner: { type: "core" }, scene },
  })
  if (errors?.length > 0) {
    throw errors[0].error
  }

  const board = (result as any)?.moodboard
  res.status(200).json({ board, moodboard: board?.scene ?? scene })
}
