/**
 * @file Admin API routes for managing task templates
 * @description Provides endpoints for creating and listing task templates in the JYT Commerce platform
 * @module API/Admin/TaskTemplates
 */

/**
 * @typedef {Object} TaskTemplateInput
 * @property {string} name - The name of the task template
 * @property {string} description - Detailed description of the task template
 * @property {"low"|"medium"|"high"} priority - Priority level of the task template
 * @property {string} category_id - ID of the category this template belongs to
 * @property {Object} metadata - Additional metadata for the template
 * @property {Object} config - Configuration options for the template
 */

/**
 * @typedef {Object} TaskTemplateResponse
 * @property {string} id - The unique identifier for the task template
 * @property {string} name - The name of the task template
 * @property {string} description - Detailed description of the task template
 * @property {"low"|"medium"|"high"} priority - Priority level of the task template
 * @property {string} category_id - ID of the category this template belongs to
 * @property {Object} metadata - Additional metadata for the template
 * @property {Object} config - Configuration options for the template
 * @property {Date} created_at - When the task template was created
 * @property {Date} updated_at - When the task template was last updated
 * @property {Object} category - Related category object (when expanded)
 */

/**
 * @typedef {Object} TaskTemplateListResponse
 * @property {TaskTemplateResponse[]} task_templates - Array of task template objects
 * @property {number} count - Total count of task templates matching filters
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Number of items returned per page
 */

/**
 * Create a new task template
 * @route POST /admin/task-templates
 * @group TaskTemplate - Operations related to task templates
 * @param {TaskTemplateInput} request.body.required - Task template data to create
 * @param {string[]} [request.remoteQueryConfig.fields] - Fields to select in the response
 * @returns {Object} 201 - Created task template object
 * @returns {TaskTemplateResponse} 201.task_template - The created task template
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/task-templates
 * {
 *   "name": "Product Listing Template",
 *   "description": "Template for creating new product listings",
 *   "priority": "high",
 *   "category_id": "cat_123456789",
 *   "metadata": {
 *     "version": "1.0",
 *     "author": "admin"
 *   },
 *   "config": {
 *     "require_approval": true,
 *     "auto_publish": false
 *   }
 * }
 *
 * @example response 201
 * {
 *   "task_template": {
 *     "id": "tmp_987654321",
 *     "name": "Product Listing Template",
 *     "description": "Template for creating new product listings",
 *     "priority": "high",
 *     "category_id": "cat_123456789",
 *     "metadata": {
 *       "version": "1.0",
 *       "author": "admin"
 *     },
 *     "config": {
 *       "require_approval": true,
 *       "auto_publish": false
 *     },
 *     "created_at": "2023-01-15T10:30:00Z",
 *     "updated_at": "2023-01-15T10:30:00Z",
 *     "category": {
 *       "id": "cat_123456789",
 *       "name": "Product Management",
 *       "description": "Templates for product-related tasks"
 *     }
 *   }
 * }
 */

/**
 * List task templates with pagination and filtering
 * @route GET /admin/task-templates
 * @group TaskTemplate - Operations related to task templates
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=10] - Number of items to return (max 100)
 * @param {string} [name] - Filter by template name (partial match)
 * @param {"low"|"medium"|"high"} [priority] - Filter by priority level
 * @param {string} [category_id] - Filter by category ID
 * @param {string[]} [fields] - Fields to select in the response
 * @param {string[]} [expand] - Relations to expand in the response
 * @returns {TaskTemplateListResponse} 200 - Paginated list of task templates
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/task-templates?offset=0&limit=5&priority=high&expand=category
 *
 * @example response 200
 * {
 *   "task_templates": [
 *     {
 *       "id": "tmp_987654321",
 *       "name": "Product Listing Template",
 *       "description": "Template for creating new product listings",
 *       "priority": "high",
 *       "category_id": "cat_123456789",
 *       "created_at": "2023-01-15T10:30:00Z",
 *       "updated_at": "2023-01-15T10:30:00Z",
 *       "category": {
 *         "id": "cat_123456789",
 *         "name": "Product Management",
 *         "description": "Templates for product-related tasks"
 *       }
 *     },
 *     {
 *       "id": "tmp_555666777",
 *       "name": "Inventory Update Template",
 *       "description": "Template for updating inventory levels",
 *       "priority": "high",
 *       "category_id": "cat_123456789",
 *       "created_at": "2023-01-10T09:15:00Z",
 *       "updated_at": "2023-01-12T14:20:00Z",
 *       "category": {
 *         "id": "cat_123456789",
 *         "name": "Product Management",
 *         "description": "Templates for product-related tasks"
 *       }
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 5
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { TaskTemplate } from "./validators";
import { createTaskTemplateWorkflow } from "../../../workflows/task-templates/create-template";
import { listTaskTemplatesWorkflow } from "../../../workflows/task-templates/list-templates";
import { TaskTemplateAllowedFields, refetchTaskTemplate } from "./helpers";

// Create new task template
export const POST = async (
  req: MedusaRequest<TaskTemplate> & {
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {

  const { result, errors } = await createTaskTemplateWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const template = await refetchTaskTemplate(
    result.id,
    req.scope,
    ["*","category.*"],
  );

  res.status(201).json({ task_template: template });
};

// List all task templates
export const GET = async (
  req: MedusaRequest & {
    query: {
      offset?: number;
      limit?: number;
      name?: string;
      priority?: "low" | "medium" | "high";
      category_id?: string;
      fields?: string[];
      expand?: string[];
    };
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse
) => {
  try {
    const { result, errors } = await listTaskTemplatesWorkflow(req.scope).run({
      input: {
        filters: {
          name: req.query.name,
          priority: req.query.priority,
          category_id: req.query.category_id,
        },
        config: {
          skip: Number(req.query.offset) || 0,
          take: Number(req.query.limit) || 10,
          select: req.query.fields,
          relations: req.query.expand,
        }
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const { templates, count } = result;

    res.status(200).json({
      task_templates: templates,
      count,
      offset: req.query.offset || 0,
      limit: req.query.limit || 10,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
