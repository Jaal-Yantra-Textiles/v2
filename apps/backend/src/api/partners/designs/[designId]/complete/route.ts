import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { completePartnerDesignWorkflow } from "../../../../../workflows/designs/complete-partner-design"
import { getPartnerFromAuthContext } from "../../../helpers"

const BodySchema = z.object({
  consumptions: z
    .array(
      z.object({
        inventory_item_id: z.string(),
        quantity: z.number().positive().optional(),
        location_id: z.string().optional(),
      })
    )
    .optional(),
})

/**
 * POST /partners/designs/[designId]/complete
 * Thin route — orchestration lives in `completePartnerDesignWorkflow`, which
 * adjusts inventory, updates design/tasks, and signals sendDesignToPartner gates.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const parsed = BodySchema.safeParse((req as any).validatedBody || (req.body as any))
  const consumptions = parsed.success ? parsed.data.consumptions : undefined

  const { result, errors } = await completePartnerDesignWorkflow(req.scope).run({
    input: { design_id: req.params.designId, consumptions },
  })
  if (errors?.length) {
    const first: any = errors[0]
    const err = first?.error || first
    const isCancelled =
      err?.type === "not_allowed" &&
      typeof err?.message === "string" &&
      err.message.includes("cancelled")
    if (isCancelled) {
      return res.status(400).json({ error: err.message })
    }
    return res.status(500).json({ error: "Failed to complete design", details: errors })
  }

  const updatedDesign = (result as any)?.updatedDesign
  const design = Array.isArray(updatedDesign) ? updatedDesign[0] : updatedDesign
  return res
    .status(200)
    .json({ message: "Design marked as completed", design, result })
}
