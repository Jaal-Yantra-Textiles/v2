/**
 * @file Admin API route for unlinking designs from products
 * @description Provides endpoints for managing product-design relationships in the JYT Commerce platform
 * @module API/Admin/Products
 */

/**
 * @typedef {Object} UnlinkDesignRequestBody
 * @property {string} designId.required - The ID of the design to unlink from the product
 */

/**
 * @typedef {Object} UnlinkDesignResponse
 * @property {boolean} success - Indicates whether the operation was successful
 */

/**
 * Unlink a design from a product
 * @route POST /admin/products/:id/unlinkDesign
 * @group Product - Operations related to products
 * @param {string} id.path.required - The ID of the product to unlink the design from
 * @param {UnlinkDesignRequestBody} request.body.required - Design ID to unlink
 * @returns {UnlinkDesignResponse} 200 - Success response
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Product or design not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/products/prod_123456789/unlinkDesign
 * {
 *   "designId": "design_987654321"
 * }
 *
 * @example response 200
 * {
 *   "success": true
 * }
 *
 * @example response 404
 * {
 *   "message": "Product with id prod_123456789 was not found",
 *   "type": "not_found"
 * }
 *
 * @example response 404
 * {
 *   "message": "Design with id design_987654321 was not found",
 *   "type": "not_found"
 * }
 *
 * @example response 400
 * {
 *   "message": "Design is still linked to the product",
 *   "type": "invalid_data"
 * }
 */
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
