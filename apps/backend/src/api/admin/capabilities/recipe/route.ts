/**
 * GET /admin/capabilities/recipe — #2596. An ordered list of steps, each with
 * the partners who can do it, their rates, alternatives with partner counts,
 * and `gap: true` where nobody can (→ sourcing, #2600). Writes nothing.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { previewRecipe } from "../../../../lib/capability-search"
import { parseRecipeSteps, type AdminPreviewRecipeQuery } from "../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = (req as any).validatedQuery as AdminPreviewRecipeQuery
  const steps = await previewRecipe(req.scope, parseRecipeSteps(q.steps), { quantity: q.quantity })
  res.json({ steps, gaps: steps.filter((s) => s.gap).map((s) => s.technique) })
}
