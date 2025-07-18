import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { unlinkProductFromDesignWorkflow } from "../../../../../workflows/products/link-unlink-products-with-designs";
import { UnlinkDesignValidator } from "../linkDesign/validators";
import { refetchProduct } from "../linkDesign/helper";
import { MedusaError } from "@medusajs/framework/utils";

export const POST = async (
    req: MedusaRequest<UnlinkDesignValidator>, res: MedusaResponse
) => {
  const { id } = req.params
  const { designId } = req.validatedBody

  const product = await refetchProduct(id, req.scope)
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product with id ${id} was not found`)
  }
  const design = product?.designs?.find((design) => design?.id === designId)
  if (!design) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design with id ${designId} was not found`)
  }

  const { errors } = await unlinkProductFromDesignWorkflow(req.scope).run({
    input: {
      productId: id,
      designId
    }
  })

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  // We must verify using the refetch if the design is unlinked
  const unLinkedProduct = await refetchProduct(id, req.scope)
  
 if (unLinkedProduct?.designs?.find((design) => design?.id === designId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Design is still linked to the product")
  }
  res.status(200).json({ 
    success: true,
   })
}
