/**
 * @file Partner API routes for design inventory management
 * @description Provides endpoints for reporting inventory consumption for designs in the JYT Commerce platform
 * @module API/Partners/Designs/Inventory
 * @deprecated This endpoint is deprecated. Use POST /partners/designs/:designId/complete instead.
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} error - Error message describing the issue
 * @property {string} message - Detailed message with migration instructions
 */

/**
 * Report inventory consumption for a design (DEPRECATED)
 * @route POST /partners/designs/:designId/inventory
 * @group Design - Operations related to design inventory
 * @param {string} designId.path.required - The ID of the design to report inventory for
 * @returns {ErrorResponse} 410 - Deprecation notice with migration instructions
 * @throws {MedusaError} 401 - Unauthorized if not authenticated
 * @throws {MedusaError} 404 - Not found if design doesn't exist
 *
 * @example request
 * POST /partners/designs/design_123456789/inventory
 *
 * @example response 410
 * {
 *   "error": "This endpoint is deprecated",
 *   "message": "Report inventory via POST /partners/designs/:designId/complete with { consumptions: [{ inventory_item_id, quantity, location_id? }] }."
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"

// Deprecated endpoint: Inventory reporting is now handled via
// POST /partners/designs/:designId/complete with an optional `consumptions` payload.
// See src/api/partners/designs/[designId]/complete/route.ts
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  return res.status(410).json({
    error: "This endpoint is deprecated",
    message: "Report inventory via POST /partners/designs/:designId/complete with { consumptions: [{ inventory_item_id, quantity, location_id? }] }.",
  })
}
