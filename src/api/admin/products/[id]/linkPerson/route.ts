import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { LinkPersonValidator } from "./validators"
import { linkProductWithPersonWorkflow } from "../../../../../workflows/products/link-unlink-products-with-people"
import { refetchProduct } from "./helper"


export const POST = async (
  req: MedusaRequest<LinkPersonValidator>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const { personId } = req.validatedBody

  const { errors } = await linkProductWithPersonWorkflow(req.scope).run({
    input: { productId: id, personId },
  })

  if (errors.length) {
    console.warn("Error reported at", errors)
    throw errors
  }

  const product = await refetchProduct(id, req.scope)
  res.status(200).json({ product })
}
