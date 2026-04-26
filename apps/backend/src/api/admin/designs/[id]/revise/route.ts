import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { reviseDesignWorkflow } from "../../../../../workflows/designs/revise-design"
import { ReviseDesignInput } from "./validators"

export async function POST(
  req: AuthenticatedMedusaRequest<ReviseDesignInput>,
  res: MedusaResponse
) {
  const designId = req.params.id
  const { revision_notes, overrides } = req.validatedBody

  const { result } = await reviseDesignWorkflow(req.scope).run({
    input: {
      design_id: designId,
      revision_notes,
      overrides,
    },
    throwOnError: true,
  })

  res.status(200).json({
    design: result,
    message: `Design revised successfully. Original design has been superseded.`,
  })
}
