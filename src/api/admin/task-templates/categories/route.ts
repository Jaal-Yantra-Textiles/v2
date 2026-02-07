/**
 * @file Admin API routes for managing task template categories
 * @description Provides endpoints for listing task template categories in the JYT Commerce platform
 * @module API/Admin/TaskTemplates/Categories
 */

/**
 * @typedef {Object} TaskTemplateCategory
 * @property {string} id - The unique identifier of the category
 * @property {string} name - The name of the category
 * @property {string} description - The description of the category
 * @property {Object} metadata - Additional metadata associated with the category
 * @property {Date} created_at - When the category was created
 * @property {Date} updated_at - When the category was last updated
 */

/**
 * @typedef {Object} TaskTemplateCategoriesListResponse
 * @property {TaskTemplateCategory[]} categories - Array of task template categories
 * @property {number} count - Total count of categories matching the query
 * @property {number} offset - The pagination offset used in the request
 * @property {number} limit - The pagination limit used in the request
 */

/**
 * List task template categories with pagination and filtering
 * @route GET /admin/task-templates/categories
 * @group Task Template Categories - Operations related to task template categories
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=10] - Number of items to return
 * @param {string} [name] - Filter by category name
 * @param {string} [description] - Filter by category description
 * @param {string[]} [fields] - Array of fields to select (e.g., ["name", "description"])
 * @param {string[]} [expand] - Array of relations to expand
 * @returns {TaskTemplateCategoriesListResponse} 200 - Paginated list of task template categories
 * @throws {MedusaError} 400 - Invalid input data or query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/task-templates/categories?offset=0&limit=10&name=Design
 *
 * @example response 200
 * {
 *   "categories": [
 *     {
 *       "id": "cat_123456789",
 *       "name": "Design",
 *       "description": "Categories related to design tasks",
 *       "metadata": {},
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "cat_987654321",
 *       "name": "Development",
 *       "description": "Categories related to development tasks",
 *       "metadata": {},
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { listTaskTemplatesCategoriesWorkflow } from "../../../../workflows/task-templates/list-template-categories";

type TaskTemplateCategoriesAllowedFields =
    | "name"
    | "description"
    | "metadata";

export const GET = async (
    req: MedusaRequest & {
      query: {
        offset?: number;
        limit?: number;
        name?: string;
        description?: string;
        fields?: string[];
        expand?: string[];
      };
      remoteQueryConfig?: {
        fields?: TaskTemplateCategoriesAllowedFields[];
      };
    },
    res: MedusaResponse
  ) => {
    try {
      const { result, errors } = await listTaskTemplatesCategoriesWorkflow(req.scope).run({
        input: {
          filters: {
            name: req.query.name,
            description: req.query.description,
          },
          config: {
            skip: Number(req.query.offset) || 0,
            take: Number(req.query.limit) || 10,
            select: req.query.fields,
          }
        },
      });
  
      if (errors.length > 0) {
        console.warn("Error reported at", errors);
        throw errors;
      }
  
      const { categories, count } = result;
  
      res.status(200).json({
        categories,
        count,
        offset: req.query.offset || 0,
        limit: req.query.limit || 10,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
  