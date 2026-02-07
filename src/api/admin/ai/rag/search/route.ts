/**
 * @file Admin API route for AI-powered RAG (Retrieval-Augmented Generation) search
 * @description Provides endpoints for semantic search across admin catalog data using vector embeddings
 * @module API/Admin/AI/RAG
 */

/**
 * @typedef {Object} AdminRagSearchQuery
 * @property {string} q - The search query string for semantic search
 * @property {number} [topK=10] - Number of results to return (default: 10)
 * @property {string} [method] - Search method to use (e.g., "COSINE", "EUCLIDEAN")
 */

/**
 * @typedef {Object} RagSearchResult
 * @property {string} id - The unique identifier of the matched resource
 * @property {string} type - The type of resource (e.g., "product", "category")
 * @property {string} name - The name of the resource
 * @property {number} score - The similarity score (0-1) between the query and resource
 * @property {Object} metadata - Additional metadata about the resource
 * @property {string} metadata.description - Description of the resource
 * @property {string[]} metadata.tags - Tags associated with the resource
 */

/**
 * @typedef {Object} RagSearchResponse
 * @property {RagSearchResult[]} results - Array of search results
 * @property {number} total - Total number of matching results
 * @property {number} topK - Number of results returned
 * @property {string} method - Search method used
 */

/**
 * Perform semantic search across admin catalog using RAG
 * @route GET /admin/ai/rag/search
 * @group AI/RAG - AI-powered retrieval augmented generation endpoints
 * @param {string} q.query.required - Search query string for semantic search
 * @param {number} [topK=10].query - Number of results to return (1-100)
 * @param {string} [method].query - Search method (COSINE, EUCLIDEAN, etc.)
 * @returns {RagSearchResponse} 200 - Search results with similarity scores
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 500 - Internal server error during search
 *
 * @example request
 * GET /admin/ai/rag/search?q=wireless+headphones&topK=5&method=COSINE
 *
 * @example response 200
 * {
 *   "results": [
 *     {
 *       "id": "prod_123456789",
 *       "type": "product",
 *       "name": "Premium Wireless Headphones",
 *       "score": 0.92,
 *       "metadata": {
 *         "description": "High-quality wireless headphones with noise cancellation",
 *         "tags": ["audio", "wireless", "premium"]
 *       }
 *     },
 *     {
 *       "id": "prod_987654321",
 *       "type": "product",
 *       "name": "Bluetooth Earbuds",
 *       "score": 0.87,
 *       "metadata": {
 *         "description": "Compact bluetooth earbuds with 20-hour battery life",
 *         "tags": ["audio", "wireless", "buds"]
 *       }
 *     }
 *   ],
 *   "total": 42,
 *   "topK": 5,
 *   "method": "COSINE"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  AdminRagSearchQuery,
  AdminRagSearchQueryType,
} from "./validators"
import { queryAdminEndpointsVectorOnly } from "../../../../../mastra/rag/adminCatalog"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = AdminRagSearchQuery.safeParse(
    ((req as any).validatedQuery || req.query || {}) as AdminRagSearchQueryType
  )

  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(", ")
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      message || "Invalid query"
    )
  }

  const { q, topK, method } = parsed.data

  const out = await queryAdminEndpointsVectorOnly(q, {
    topK: typeof topK === "number" ? topK : 10,
    method: method ? String(method).toUpperCase() : undefined,
  })

  return res.json(out)
}
