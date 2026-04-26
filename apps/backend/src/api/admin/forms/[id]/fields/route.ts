/**
 * @file Admin API routes for managing form fields
 * @description Provides endpoints for updating fields of a specific form in the JYT Commerce platform
 * @module API/Admin/Forms/Fields
 */

/**
 * @typedef {Object} FormField
 * @property {string} id - The unique identifier of the field
 * @property {string} label - The display label of the field
 * @property {string} type - The type of field (text, select, checkbox, etc.)
 * @property {boolean} required - Whether the field is required
 * @property {string} [placeholder] - Optional placeholder text
 * @property {Array<Object>} [options] - Available options for select fields
 * @property {string} [default_value] - Default value for the field
 */

/**
 * @typedef {Object} AdminSetFormFieldsInput
 * @property {Array<FormField>} fields - Array of field objects to update
 */

/**
 * @typedef {Object} FormResponse
 * @property {string} id - The unique identifier of the form
 * @property {string} title - The title of the form
 * @property {string} description - The description of the form
 * @property {string} status - The status of the form (active/inactive)
 * @property {Array<FormField>} fields - Array of field objects
 * @property {Date} created_at - When the form was created
 * @property {Date} updated_at - When the form was last updated
 * @property {Object} metadata - Additional metadata about the form
 */

/**
 * Update fields for a specific form
 * @route POST /admin/forms/:id/fields
 * @group Form Fields - Operations related to form fields
 * @param {string} id.path.required - The ID of the form to update
 * @param {AdminSetFormFieldsInput} request.body.required - Form field data to update
 * @returns {FormResponse} 200 - Updated form object with fields
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Form not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/forms/form_123456789/fields
 * {
 *   "fields": [
 *     {
 *       "id": "field_123",
 *       "label": "First Name",
 *       "type": "text",
 *       "required": true,
 *       "placeholder": "Enter your first name"
 *     },
 *     {
 *       "id": "field_456",
 *       "label": "Country",
 *       "type": "select",
 *       "required": false,
 *       "options": [
 *         { "value": "us", "label": "United States" },
 *         { "value": "ca", "label": "Canada" }
 *       ]
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "form": {
 *     "id": "form_123456789",
 *     "title": "Customer Information",
 *     "description": "Form for collecting customer details",
 *     "status": "active",
 *     "fields": [
 *       {
 *         "id": "field_123",
 *         "label": "First Name",
 *         "type": "text",
 *         "required": true,
 *         "placeholder": "Enter your first name"
 *       },
 *       {
 *         "id": "field_456",
 *         "label": "Country",
 *         "type": "select",
 *         "required": false,
 *         "options": [
 *           { "value": "us", "label": "United States" },
 *           { "value": "ca", "label": "Canada" }
 *         ]
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-06-15T10:30:00Z",
 *     "metadata": {}
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { setFormFieldsWorkflow } from "../../../../../workflows/forms/set-form-fields"
import { refetchForm } from "../../helpers"
import { AdminSetFormFields } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminSetFormFields>,
  res: MedusaResponse
) => {
  const { result } = await setFormFieldsWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      fields: req.validatedBody.fields,
    },
  })

  const form = await refetchForm((result as any).form_id || req.params.id, req.scope)
  res.status(200).json({ form })
}
