/**
 * This API takes one design id and links it to the product, its a POST 
 * request
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { LinkDesignValidator } from "./validators";
import { linkProductWithDesignWorkflow } from "../../../../../workflows/products/link-unlink-products-with-designs";
import { refetchProduct } from "./helper";

export const POST = async(
  req: MedusaRequest<LinkDesignValidator>,
  res: MedusaResponse
) => {
  const { id } = req.params

  const { designId } = req.validatedBody

  const { errors } = await linkProductWithDesignWorkflow(req.scope).run({
    input: {
      productId: id,
      designId
    }
  })
  
  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  // We are going to refetch the product and see if its linked
  const product = await refetchProduct(
    id,
    req.scope,
  );

  res.status(200).json({ product })
}
