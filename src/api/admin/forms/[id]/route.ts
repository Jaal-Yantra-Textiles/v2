/**
 * @file Admin API routes for managing forms
 * @description Provides endpoints for retrieving, updating, and deleting forms in the JYT Commerce platform
 * @module API/Admin/Forms
 */

/**
 * @typedef {Object} AdminUpdateForm
 * @property {string} [title] - The title of the form
 * @property {string} [description] - The description of the form
 * @property {string} [status] - The status of the form (active/inactive)
 * @property {Object[]} [fields] - The fields of the form
 * @property {string} fields[].id - The unique identifier of the field
 * @property {string} fields[].label - The label of the field
 * @property {string} fields[].type - The type of the field (text, number, etc.)
 * @property {boolean} fields[].required - Whether the field is required
 */

/**
 * @typedef {Object} FormResponse
 * @property {string} id - The unique identifier of the form
 * @property {string} title - The title of the form
 * @property {string} description - The description of the form
 * @property {string} status - The status of the form (active/inactive)
 * @property {Object[]} fields - The fields of the form
 * @property {string} fields[].id - The unique identifier of the field
 * @property {string} fields[].label - The label of the field
 * @property {string} fields[].type - The type of the field (text, number, etc.)
 * @property {boolean} fields[].required - Whether the field is required
 * @property {Date} created_at - When the form was created
 * @property {Date} updated_at - When the form was last updated
 */

/**
 * Retrieve a form by ID
 * @route GET /admin/forms/:id
 * @group Form - Operations related to forms
 * @param {string} id.path.required - The ID of the form to retrieve
 * @returns {Object} 200 - The form object
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Form not found
 *
 * @example request
 * GET /admin/forms/form_123456789
 *
 * @example response 200
 * {
 *   "form": {
 *     "id": "form_123456789",
 *     "title": "Contact Us",
 *     "description": "A form for users to contact us",
 *     "status": "active",
 *     "fields": [
 *       {
 *         "id": "field_123456789",
 *         "label": "Name",
 *         "type": "text",
 *         "required": true
 *       },
 *       {
 *         "id": "field_987654321",
 *         "label": "Email",
 *         "type": "email",
 *         "required": true
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Update a form by ID
 * @route POST /admin/forms/:id
 * @group Form - Operations related to forms
 * @param {string} id.path.required - The ID of the form to update
 * @param {AdminUpdateForm} request.body.required - Form data to update
 * @returns {Object} 200 - The updated form object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Form not found
 *
 * @example request
 * POST /admin/forms/form_123456789
 * {
 *   "title": "Updated Contact Us",
 *   "description": "An updated form for users to contact us",
 *   "status": "active",
 *   "fields": [
 *     {
 *       "id": "field_123456789",
 *       "label": "Full Name",
 *       "type": "text",
 *       "required": true
 *     },
 *     {
 *       "id": "field_987654321",
 *       "label": "Email Address",
 *       "type": "email",
 *       "required": true
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "form": {
 *     "id": "form_123456789",
 *     "title": "Updated Contact Us",
 *     "description": "An updated form for users to contact us",
 *     "status": "active",
 *     "fields": [
 *       {
 *         "id": "field_123456789",
 *         "label": "Full Name",
 *         "type": "text",
 *         "required": true
 *       },
 *       {
 *         "id": "field_987654321",
 *         "label": "Email Address",
 *         "type": "email",
 *         "required": true
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z"
 *   }
 * }
 */

/**
 * Delete a form by ID
 * @route DELETE /admin/forms/:id
 * @group Form - Operations related to forms
 * @param {string} id.path.required - The ID of the form to delete
 * @returns {Object} 200 - Confirmation of deletion
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Form not found
 *
 * @example request
 * DELETE /admin/forms/form_123456789
 *
 * @example response 200
 * {
 *   "id": "form_123456789",
 *   "object": "form",
 *   "deleted": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { deleteFormWorkflow } from "../../../../workflows/forms/delete-form"
import { updateFormWorkflow } from "../../../../workflows/forms/update-form"
import { AdminUpdateForm } from "../validators"
import { refetchForm } from "../helpers"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const form = await refetchForm(req.params.id, req.scope)
  res.status(200).json({ form })
}

export const POST = async (
  req: MedusaRequest<AdminUpdateForm>,
  res: MedusaResponse
) => {
  const { result } = await updateFormWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  })

  const form = await refetchForm((result as any).id || req.params.id, req.scope)
  res.status(200).json({ form })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteFormWorkflow(req.scope).run({
    input: { id: req.params.id },
  })

  res.status(200).json({
    id: req.params.id,
    object: "form",
    deleted: true,
  })
}
