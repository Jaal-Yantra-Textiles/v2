/**
 * @file Admin API routes for managing design resources
 * @description Provides endpoints for handling design-specific operations in the JYT Commerce platform
 * @module API/Admin/Designs
 */

/**
 * @typedef {Object} DesignPathResponse
 * @property {string} message - Descriptive message about the operation
 * @property {string} designId - The unique identifier of the design
 * @property {string} path - The specific path being accessed
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} message - Error message describing what went wrong
 */

/**
 * Handle GET requests for design-specific paths
 * @route GET /admin/designs/:id/:path
 * @group Design - Operations related to designs
 * @param {string} id.path.required - The unique identifier of the design
 * @param {string} path.path.required - The specific path to access (e.g., "notes", "test")
 * @returns {DesignPathResponse} 200 - Success response with design path information
 * @throws {ErrorResponse} 404 - Path not found for the specified design
 *
 * @example request
 * GET /admin/designs/design_123456789/notes
 *
 * @example response 200
 * {
 *   "message": "Notes path handler",
 *   "designId": "design_123456789",
 *   "path": "notes"
 * }
 *
 * @example request
 * GET /admin/designs/design_123456789/test
 *
 * @example response 200
 * {
 *   "message": "Test path handler",
 *   "designId": "design_123456789",
 *   "path": "test"
 * }
 *
 * @example request
 * GET /admin/designs/design_123456789/unknown
 *
 * @example response 404
 * {
 *   "message": "Path unknown not found for design design_123456789"
 * }
 */

/**
 * Handle POST requests for design-specific paths
 * @route POST /admin/designs/:id/:path
 * @group Design - Operations related to designs
 * @param {string} id.path.required - The unique identifier of the design
 * @param {string} path.path.required - The specific path to access (e.g., "notes")
 * @param {Object} request.body.required - Request body data
 * @returns {DesignPathResponse} 200 - Success response with design path information
 * @throws {ErrorResponse} 404 - Path not found for the specified design
 *
 * @example request
 * POST /admin/designs/design_123456789/notes
 * {
 *   "content": "This is a note about the design."
 * }
 *
 * @example response 200
 * {
 *   "message": "Notes path handler - POST",
 *   "designId": "design_123456789",
 *   "path": "notes"
 * }
 *
 * @example request
 * POST /admin/designs/design_123456789/unknown
 * {
 *   "content": "This is a note about the design."
 * }
 *
 * @example response 404
 * {
 *   "message": "Path unknown not found for design design_123456789"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"


export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id, path } = req.params

 

  // Check if the path is for notes
  if (path === "notes") {
    
    return res.json({
      message: "Notes path handler",
      designId: id,
      path: path
    })
  }

  if (path === "test") {
    
    return res.json({
      message: "Test path handler",
      designId: id,
      path: path
    })
  }

  // Return 404 for unknown paths
  return res.status(404).json({
    message: `Path ${path} not found for design ${id}`
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id, path } = req.params

  if (path[0] === "notes") {
    console.log("Received POST request for notes path:", { 
      designId: id, 
      path,
      body: req.body 
    })
    return res.json({
      message: "Notes path handler - POST",
      designId: id,
      path: path
    })
  }

  return res.status(404).json({
    message: `Path ${path} not found for design ${id}`
  })
}

