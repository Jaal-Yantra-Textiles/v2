import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { GenerateDescriptionValidator } from "./validators"
import { generateProductDescriptionWorkflow } from "../../../../../workflows/products/gen-ai-desc"
import { MedusaError } from "@medusajs/utils"

export const POST = async (
  req: MedusaRequest<GenerateDescriptionValidator>,
  res: MedusaResponse
) => {
  const { id } = req.params

  const body = req.validatedBody
  if (!body?.imageUrl) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "imageUrl is required"
    )
  }

  const hint = body.hint ?? body.notes

  const { result, errors } = await generateProductDescriptionWorkflow(req.scope).run({
    input: {
      imageUrl: body.imageUrl,
      hint,
      productData: body.productData || {},
    },
  })

  if (errors.length) {
    // Surface first error for simplicity
    throw errors[0]
  }

  // result is the workflow response from Mastra validation step
  // Ensure shape contains title and description
  const { title, description } = result as { title: string; description: string }

  res.status(200).json({
    product_id: id,
    title,
    description,
  })
}
