/**
 * @file Admin API routes for managing websites
 * @description Provides endpoints for creating and listing websites in the JYT Commerce platform
 * @module API/Admin/Websites
 */

/**
 * @typedef {Object} WebsiteInput
 * @property {string} name - The name of the website
 * @property {string} domain - The domain of the website
 * @property {string} status - The status of the website (active/inactive)
 * @property {Object[]} pages - Array of page objects associated with the website
 */

/**
 * @typedef {Object} WebsiteResponse
 * @property {string} id - The unique identifier of the website
 * @property {string} name - The name of the website
 * @property {string} domain - The domain of the website
 * @property {string} status - The status of the website
 * @property {Date} created_at - When the website was created
 * @property {Date} updated_at - When the website was last updated
 * @property {Object[]} pages - Array of page objects
 */

/**
 * @typedef {Object} ListWebsitesResponse
 * @property {WebsiteResponse[]} websites - Array of website objects
 * @property {number} count - Total count of websites matching filters
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Number of items per page
 * @property {boolean} hasMore - Whether more items are available
 */

/**
 * Create a new website
 * @route POST /admin/websites
 * @group Website - Operations related to websites
 * @param {WebsiteInput} request.body.required - Website data to create
 * @returns {WebsiteResponse} 201 - Created website object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Server error
 *
 * @example request
 * POST /admin/websites
 * {
 *   "name": "My Store",
 *   "domain": "my-store.com",
 *   "status": "active",
 *   "pages": [
 *     {
 *       "title": "Home",
 *       "path": "/"
 *     }
 *   ]
 * }
 *
 * @example response 201
 * {
 *   "website": {
 *     "id": "web_123456789",
 *     "name": "My Store",
 *     "domain": "my-store.com",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "pages": [
 *       {
 *         "id": "page_123",
 *         "title": "Home",
 *         "path": "/"
 *       }
 *     ]
 *   }
 * }
 */

/**
 * List websites with pagination and filtering
 * @route GET /admin/websites
 * @group Website - Operations related to websites
 * @param {string} [name] - Filter by website name (partial match)
 * @param {string} [status] - Filter by website status (active/inactive)
 * @param {string} [domain] - Filter by website domain (partial match)
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=10] - Number of items to return (max 100)
 * @returns {ListWebsitesResponse} 200 - Paginated list of websites
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Server error
 *
 * @example request
 * GET /admin/websites?name=store&status=active&offset=0&limit=10
 *
 * @example response 200
 * {
 *   "websites": [
 *     {
 *       "id": "web_123456789",
 *       "name": "My Store",
 *       "domain": "my-store.com",
 *       "status": "active",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "pages": []
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10,
 *   "hasMore": false
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { createWebsiteWorkflow } from "../../../workflows/website/create-website";
import { WebsiteSchema } from "./validators";
import {
  ListWebsiteWorkflowInput,
  listWebsiteWorkflow,
} from "../../../workflows/website/list-website";

export const POST = async (
  req: MedusaRequest<WebsiteSchema>,
  res: MedusaResponse,
) => {
 
  const { result } = await createWebsiteWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ website: result });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { name, status, domain } = req.query;
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = parseInt(req.query.limit as string) || 10;

  const workflowInput: ListWebsiteWorkflowInput = {
    config: {
      relations: ["pages"],
      skip: offset,
      take: limit
    },
    filters: {
      name,
      status,
      domain,
    }
  };

  const { result } = await listWebsiteWorkflow(req.scope).run({
    input: workflowInput,
  });

  const [websites, count] = result;

  res.json({
    websites,
    count,
    offset,
    limit,
    hasMore: offset + websites.length < count,
  });
};
