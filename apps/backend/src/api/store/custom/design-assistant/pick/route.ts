/**
 * Storefront design-assistant — deterministic canvas pick.
 *
 *   POST /store/custom/design-assistant/pick
 *   { design_id, canvas_id }
 *
 * The scene panel's "Build on this" action calls this directly (deterministic,
 * no model turn required) — the same write `set_active_canvas` performs when
 * the maker says "pick take B" in chat. Marks the canvas active in the
 * Excalidraw scene on design.moodboard and stamps design.thumbnail_url.
 *
 * Reuses the chat flow's runSetActiveCanvas (single source of truth for the
 * pick semantics). Public — mirrors the flow's email gate; ownership is
 * enforced by the scene lookup (the canvas must be on the design's board).
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { runSetActiveCanvas } from "../../../../../mastra/agents/tools/storefront-design-flow"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const validated = (req as any).validatedBody
  if (!validated?.design_id || !validated?.canvas_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "design_id and canvas_id are required"
    )
  }

  try {
    const result = await runSetActiveCanvas(req.scope as any, {
      design_id: validated.design_id,
      canvas_id: validated.canvas_id,
    })
    return res.status(200).json(result)
  } catch (e: any) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      e?.message || "Canvas pick failed"
    )
  }
}

