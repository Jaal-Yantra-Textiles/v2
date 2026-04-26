/**
 * @file Admin API route for generating custom OpenAPI specification
 * @description Provides an endpoint to generate OpenAPI 3.1.0 specification for custom admin routes
 * @module API/Admin/AI/OpenAPI
 */

/**
 * @typedef {Object} OpenApiInfo
 * @property {string} title - The title of the API specification
 * @property {string} version - The version of the API specification
 * @property {string} description - Description of the API specification
 */

/**
 * @typedef {Object} OpenApiServer
 * @property {string} url - The base URL of the API server
 * @property {string} description - Description of the server
 */

/**
 * @typedef {Object} OpenApiSecurity
 * @property {string} bearerAuth - Authentication scheme (bearer token)
 */

/**
 * @typedef {Object} OpenApiDocument
 * @property {string} openapi - OpenAPI specification version
 * @property {OpenApiInfo} info - Metadata about the API
 * @property {OpenApiServer[]} servers - Available API servers
 * @property {Object} paths - Available paths and operations
 * @property {Object} components - Reusable components
 * @property {OpenApiSecurity[]} security - Security requirements
 */

/**
 * Generate OpenAPI 3.1.0 specification for custom admin routes
 * @route GET /admin/ai/openapi/custom
 * @group AI - Artificial Intelligence related operations
 * @operationId getCustomOpenApiSpec
 * @returns {OpenApiDocument} 200 - OpenAPI 3.1.0 specification document
 * @throws {MedusaError} 500 - Internal server error when generating specification
 *
 * @example request
 * GET /admin/ai/openapi/custom
 *
 * @example response 200
 * {
 *   "openapi": "3.1.0",
 *   "info": {
 *     "title": "JYT Admin APIs (Custom)",
 *     "version": "1.0.0",
 *     "description": "OpenAPI specification for custom admin routes under src/api/admin."
 *   },
 *   "servers": [
 *     {
 *       "url": "/admin",
 *       "description": "Admin API base"
 *     }
 *   ],
 *   "paths": {
 *     "/custom-route": {
 *       "get": {
 *         "operationId": "getCustomRoute",
 *         "responses": {
 *           "200": {
 *             "description": "Successful response"
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "components": {
 *     "schemas": {},
 *     "securitySchemes": {
 *       "bearerAuth": {
 *         "type": "http",
 *         "scheme": "bearer",
 *         "bearerFormat": "JWT"
 *       }
 *     }
 *   },
 *   "security": [
 *     {
 *       "bearerAuth": []
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi"
import { buildRegistry } from "./registry"

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  const registry = buildRegistry()
  const generator = new OpenApiGeneratorV31(registry.definitions)

  const doc = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "JYT Admin APIs (Custom)",
      version: "1.0.0",
      description: "OpenAPI specification for custom admin routes under src/api/admin.",
    },
    servers: [{ url: "/admin", description: "Admin API base" }],
    security: [{ bearerAuth: [] }],
  })

  return res.json(doc)
}