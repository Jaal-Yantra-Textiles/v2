/**
 * @file Store API route for custom endpoint
 * @description Provides a custom endpoint for the JYT Commerce storefront
 * @module API/Store/Custom
 */

/**
 * @typedef {Object} CustomResponse
 * @property {string} status - The status of the response
 * @property {string} message - A descriptive message about the response
 */

/**
 * Custom endpoint for storefront
 * @route GET /store/custom
 * @group Store - Operations related to the storefront
 * @returns {CustomResponse} 200 - Success response
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /store/custom
 *
 * @example response 200
 * {
 *   "status": "success",
 *   "message": "Custom endpoint is working"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  res.sendStatus(200);
}
