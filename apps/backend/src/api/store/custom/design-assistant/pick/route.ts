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
 * pick semantics).
 *
 * 🔴 #2543: this used to treat knowing a `design_id` as enough to rewrite the
 * maker's pick and thumbnail. It now needs the design's access token
 * (`x-design-token`) or a signed-in customer linked to the design — the same
 * check every chat tool runs (lib/design-access/authorize.ts). The check runs
 * before the design is read, so a denial says nothing about existence.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  assertDesignAccess,
  readDesignCredentials,
} from "../../../../../lib/design-access/authorize"
import { runSetActiveCanvas } from "../../../../../mastra/agents/tools/storefront-design-flow"
import type { PickDesignCanvasInput } from "./validators"

export const POST = async (
  req: AuthenticatedMedusaRequest<PickDesignCanvasInput>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as PickDesignCanvasInput
  const credentials = readDesignCredentials(req)

  // Throws the 403 (Medusa error handler) before anything is read.
  await assertDesignAccess(req.scope as any, body.design_id, credentials)

  try {
    const result = await runSetActiveCanvas(
      req.scope as any,
      { design_id: body.design_id, canvas_id: body.canvas_id },
      credentials
    )
    return res.status(200).json(result)
  } catch (e: any) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      e?.message || "Canvas pick failed"
    )
  }
}
