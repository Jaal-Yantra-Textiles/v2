/**
 * @file Admin API routes for managing websites
 * @description Provides endpoints for retrieving, updating, and deleting websites in the JYT Commerce platform
 * @module API/Admin/Websites
 */

/**
 * @typedef {Object} WebsiteResponse
 * @property {string} id - The unique identifier of the website
 * @property {string} name - The name of the website
 * @property {string} domain - The domain of the website
 * @ @property {string} status - The status of the website (active/inactive)
 * @property {Date} created_at - When the website was created
 * @property {Date} updated_at - When the website was last updated
 * @property {Array<Object>} pages - Array of pages associated with the website
 */

/**
 * @typedef {Object} UpdateWebsiteInput
 * @property {string} [name] - The name of the website
 * @property {string} [domain] - The domain of the website
 * @property {string} [status] - The status of the website (active/inactive)
 * @property {Array<string>} [page_ids] - Array of page IDs to associate with the website
 */

/**
 * Get a website by ID
 * @route GET /admin/websites/:id
 * @group Website - Operations related to websites
 * @param {string} id.path.required - The ID of the website to retrieve
 * @returns {Object} 200 - Website object
 * @throws {MedusaError} 404 - Website not found
 *
 * @example request
 * GET /admin/websites/web_123456789
 *
 * @example response 200
 * {
 *   "website": {
 *     "id": "web_123456789",
 *     "name": "My Website",
 *     "domain": "example.com",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "pages": [
 *       {
 *         "id": "page_123456789",
 *         "title": "Home",
 *         "path": "/"
 *       }
 *     ]
 *   }
 * }
 */

/**
 * Update a website
 * @route PUT /admin/websites/:id
 * @group Website - Operations related to websites
 * @param {string} id.path.required - The ID of the website to update
 * @param {UpdateWebsiteInput} request.body.required - Website data to update
 * @returns {Object} 200 - Updated website object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Website not found
 *
 * @example request
 * PUT /admin/websites/web_123456789
 * {
 *   "name": "Updated Website",
 *   "domain": "updated-example.com",
 *   "status": "active",
 *   "page_ids": ["page_123456789", "page_987654321"]
 * }
 *
 * @example response 200
 * {
 *   "website": {
 *     "id": "web_123456789",
 *     "name": "Updated Website",
 *     "domain": "updated-example.com",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-03T00:00:00Z",
 *     "pages": [
 *       {
 *         "id": "page_123456789",
 *         "title": "Home",
 *         "path": "/"
 *       },
 *       {
 *         "id": "page_987654321",
 *         "title": "About",
 *         "path": "/about"
 *       }
 *     ]
 *   }
 * }
 */

/**
 * Delete a website
 * @route DELETE /admin/websites/:id
 * @group Website - Operations related to websites
 * @param {string} id.path.required - The ID of the website to delete
 * @returns {Object} 200 - Confirmation of deletion
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Website not found
 *
 * @example request
 * DELETE /admin/websites/web_123456789
 *
 * @example response 200
 * {
 *   "id": "web_123456789",
 *   "object": "website",
 *   "deleted": true
 * }
 */
import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { DeleteWebsiteSchema, UpdateWebsiteSchema } from "../validators";
import { deleteWebsiteWorkflow } from "../../../../workflows/website/delete-website";
import { WEBSITE_MODULE } from "../../../../modules/website";
import WebsiteService from "../../../../modules/website/service";
import { updateWebsiteWorkflow } from "../../../../workflows/website/update-website";
import { refetchWebsite } from "../helpers";

export const DELETE = async (
  req: MedusaRequest<DeleteWebsiteSchema>,
  res: MedusaResponse,
) => {
  const { id } = req.params;

  const { result, errors } = await deleteWebsiteWorkflow(req.scope).run({
    input: {
      id: id,
    },
  });
  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  res.status(200).json({
    id,
    object: "website",
    deleted: true,
  });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE);
  const { id } = req.params;

  try {
    const website = await websiteService.retrieveWebsite(id, 
      {
        relations:['pages']  
      }
    );
    res.status(200).json({ website });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const PUT = async (
  req: AuthenticatedMedusaRequest<UpdateWebsiteSchema>,
  res: MedusaResponse,
) => {
  const { id } = req.params;
 
  const { result, errors } = await updateWebsiteWorkflow(req.scope).run({
    input: {
      id,
      ...req.validatedBody,
    },
  });

  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const website = await refetchWebsite(result.id, req.scope);

  res.status(200).json({ website });
};
