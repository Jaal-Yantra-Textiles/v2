/**
 * @file Admin API routes for AI image extraction audit
 * @description Provides endpoints for retrieving recent image extraction memory entries in the JYT Commerce platform
 * @module API/Admin/AI/ImageExtraction
 */

/**
 * @typedef {Object} ImageExtractionAuditEntry
 * @property {string} id - The unique identifier of the audit entry
 * @property {string} resource - The resource ID associated with the extraction
 * @property {string} prefix - The prefix used for memory storage
 * @property {string} content - The extracted content or metadata
 * @property {Date} created_at - When the extraction was performed
 * @property {Date} updated_at - When the entry was last updated
 */

/**
 * @typedef {Object} ImageExtractionAuditListResponse
 * @property {ImageExtractionAuditEntry[]} entries - List of image extraction audit entries
 * @property {number} count - Total number of entries available
 * @property {number} limit - Number of entries returned
 */

/**
 * Get recent image extraction memory entries
 * @route GET /admin/ai/image-extraction/recent
 * @group AI/ImageExtraction - Operations related to AI image extraction
 * @param {string} [resource] - Optional resource ID to filter entries
 * @param {string} [prefix=image-extraction:] - Prefix filter for memory entries
 * @param {number} [limit=10] - Maximum number of entries to return (max 50)
 * @returns {ImageExtractionAuditListResponse} 200 - List of recent image extraction audit entries
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/ai/image-extraction/recent?resource=prod_12345&prefix=image-extraction:&limit=5
 *
 * @example response 200
 * {
 *   "entries": [
 *     {
 *       "id": "audit_001",
 *       "resource": "prod_12345",
 *       "prefix": "image-extraction:",
 *       "content": "Extracted product image metadata",
 *       "created_at": "2023-01-15T10:30:00Z",
 *       "updated_at": "2023-01-15T10:30:00Z"
 *     },
 *     {
 *       "id": "audit_002",
 *       "resource": "prod_12345",
 *       "prefix": "image-extraction:",
 *       "content": "Extracted product variant images",
 *       "created_at": "2023-01-14T09:15:00Z",
 *       "updated_at": "2023-01-14T09:15:00Z"
 *     }
 *   ],
 *   "count": 2,
 *   "limit": 5
 * }
 *
 * @example response 400
 * {
 *   "message": "Invalid limit parameter"
 * }
 *
 * @example response 500
 * {
 *   "message": "Unexpected error occurred while fetching image extraction audit entries"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { listImageExtractionAuditWorkflow } from "../../../../../workflows/ai/list-image-extraction-audit";

// GET /admin/ai/image-extraction/recent?resource=<id>&prefix=<prefix>&limit=<n>
// Returns a list of recent image extraction memory entries.
// NOTE: Querying Mastra memory is not wired yet; returns [] for now if unsupported.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const resource = (req.query.resource as string) || undefined
    const prefix = (req.query.prefix as string) || "image-extraction:"
    const limit = Math.min(parseInt((req.query.limit as string) || "10", 10) || 10, 50)

    const { result } = await listImageExtractionAuditWorkflow(req.scope).run({
      input: { resource, prefix, limit },
    })

    return res.status(200).json(result)
  } catch (e) {
    const err = e as Error
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: err.message })
    }
    return res.status(500).json({ message: err.message || "Unexpected error" })
  }
}
