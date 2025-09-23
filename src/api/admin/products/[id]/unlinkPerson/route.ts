import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { UnlinkPersonValidator } from "../linkPerson/validators"
import { unlinkProductFromPersonWorkflow } from "../../../../../workflows/products/link-unlink-products-with-people"
import { refetchProduct } from "../linkPerson/helper"

export const POST = async (
  req: MedusaRequest<UnlinkPersonValidator>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const { personId } = req.validatedBody

  const { errors } = await unlinkProductFromPersonWorkflow(req.scope).run({
    input: { productId: id, personId },
  })

  if (errors.length) {
    console.warn("Error reported at", errors)
    throw errors
  }

  const product = await refetchProduct(id, req.scope)
  res.status(200).json({ product })
}
