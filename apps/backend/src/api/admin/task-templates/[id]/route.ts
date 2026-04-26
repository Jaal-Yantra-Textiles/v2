/**
 * @file Admin API routes for managing task templates
 * @description Provides endpoints for retrieving, updating, and deleting task templates in the JYT Commerce platform
 * @module API/Admin/TaskTemplates
 */

/**
 * @typedef {Object} TaskTemplateResponse
 * @property {string} id - The unique identifier of the task template
 * @property {string} title - The title of the task template
 * @property {string} description - The description of the task template
 * @property {string} status - The status of the task template (active/inactive)
 * @property {string} category_id - The ID of the category this template belongs to
 * @property {Object} category - The category details
 * @property {string} category.id - The unique identifier of the category
 * @property {string} category.name - The name of the category
 * @property {Date} created_at - When the task template was created
 * @property {Date} updated_at - When the task template was last updated
 */

/**
 * @typedef {Object} UpdateTaskTemplateInput
 * @property {string} [title] - The title of the task template
 * @property {string} [description] - The description of the task template
 * @property {string} [status] - The status of the task template (active/inactive)
 * @property {string} [category_id] - The ID of the category this template belongs to
 */

/**
 * Get a single task template by ID
 * @route GET /admin/task-templates/:id
 * @group TaskTemplate - Operations related to task templates
 * @param {string} id.path.required - The ID of the task template to retrieve
 * @param {string[]} [fields] - Fields to include in the response (optional)
 * @returns {Object} 200 - The requested task template object
 * @throws {MedusaError} 404 - Task template not found
 *
 * @example request
 * GET /admin/task-templates/design_123456789
 *
 * @example response 200
 * {
 *   "task_template": {
 *     "id": "design_123456789",
 *     "title": "Website Redesign",
 *     "description": "Complete redesign of the company website",
 *     "status": "active",
 *     "category_id": "cat_987654321",
 *     "category": {
 *       "id": "cat_987654321",
 *       "name": "Design"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-15T10:30:00Z"
 *   }
 * }
 */

/**
 * Update a task template
 * @route PUT /admin/task-templates/:id
 * @group TaskTemplate - Operations related to task templates
 * @param {string} id.path.required - The ID of the task template to update
 * @param {UpdateTaskTemplateInput} request.body.required - Task template data to update
 * @returns {Object} 200 - The updated task template object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task template not found
 *
 * @example request
 * PUT /admin/task-templates/design_123456789
 * {
 *   "title": "Website Redesign - Phase 2",
 *   "status": "inactive"
 * }
 *
 * @example response 200
 * {
 *   "task_template": {
 *     "id": "design_123456789",
 *     "title": "Website Redesign - Phase 2",
 *     "description": "Complete redesign of the company website",
 *     "status": "inactive",
 *     "category_id": "cat_987654321",
 *     "category": {
 *       "id": "cat_987654321",
 *       "name": "Design"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-02-20T14:45:00Z"
 *   }
 * }
 */

/**
 * Delete a task template
 * @route DELETE /admin/task-templates/:id
 * @group TaskTemplate - Operations related to task templates
 * @param {string} id.path.required - The ID of the task template to delete
 * @returns {void} 204 - Task template successfully deleted
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task template not found
 *
 * @example request
 * DELETE /admin/task-templates/design_123456789
 *
 * @example response 204
 * (No content)
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { UpdateTaskTemplate } from "../validators";
import { updateTaskTemplateWorkflow } from "../../../../workflows/task-templates/update-template";
import { deleteTaskTemplateWorkflow } from "../../../../workflows/task-templates/delete-template";
import { TaskTemplateAllowedFields, refetchTaskTemplate } from "../helpers";
import { listSingleTaskTemplateWorkflow } from "../../../../workflows/task-templates/list-single-template";

// GET single task template
export const GET = async (
  req: MedusaRequest & {
    params: { id: string };
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse
) => {
  try {
    const { result } = await listSingleTaskTemplateWorkflow(req.scope).run({
      input: {
        id: req.params.id,
        config: {
          relations:[ "category"]
        }
      },
    });
   
    res.status(200).json({ task_template: result });
  } catch (error) {
    res.status(404).json({ error: "Task template not found" });
  }
};

// Update task template
export const PUT = async (
  req: MedusaRequest<UpdateTaskTemplate> & {
    params: { id: string };
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const { result, errors } = await updateTaskTemplateWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      update: req.validatedBody,
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const template = await refetchTaskTemplate(
    req.params.id,
    req.scope,
    ["*","category.*", "category.name"],
  );


  res.status(200).json({ task_template: template });
};

// Delete task template
export const DELETE = async (
  req: MedusaRequest & {
    params: { id: string };
  },
  res: MedusaResponse,
) => {
  const { errors } = await deleteTaskTemplateWorkflow(req.scope).run({
    input: {
      id: req.params.id,
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  res.status(204).send();
};
