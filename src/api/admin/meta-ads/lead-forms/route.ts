/**
 * @file Admin API routes for managing Meta Ads lead forms
 * @description Provides endpoints for creating and listing lead forms in the JYT Commerce platform
 * @module API/Admin/MetaAds
 */

/**
 * @typedef {Object} LeadFormInput
 * @property {string} platform_id - The ID of the platform associated with the lead form
 * @property {string} name - The name of the lead form
 * @property {string} description - The description of the lead form
 * @property {Object} fields - The fields included in the lead form
 * @property {string} fields.name - The name of the field
 * @property {string} fields.type - The type of the field (e.g., text, email, phone)
 * @property {boolean} fields.required - Whether the field is required
 */

/**
 * @typedef {Object} LeadFormResponse
 * @property {string} id - The unique identifier of the lead form
 * @property {string} platform_id - The ID of the platform associated with the lead form
 * @property {string} name - The name of the lead form
 * @property {string} description - The description of the lead form
 * @property {Object} fields - The fields included in the lead form
 * @property {string} fields.name - The name of the field
 * @property {string} fields.type - The type of the field (e.g., text, email, phone)
 * @property {boolean} fields.required - Whether the field is required
 * @property {Date} created_at - When the lead form was created
 * @property {Date} updated_at - When the lead form was last updated
 */

/**
 * List all lead forms
 * @route GET /admin/meta-ads/lead-forms
 * @group Meta Ads - Operations related to Meta Ads lead forms
 * @param {string} [platform_id] - Filter lead forms by platform ID
 * @returns {Object} 200 - List of lead forms and count
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/meta-ads/lead-forms?platform_id=meta_123456789
 *
 * @example response 200
 * {
 *   "leadForms": [
 *     {
 *       "id": "lead_form_123456789",
 *       "platform_id": "meta_123456789",
 *       "name": "Contact Us",
 *       "description": "Form for users to contact us",
 *       "fields": [
 *         {
 *           "name": "email",
 *           "type": "email",
 *           "required": true
 *         },
 *         {
 *           "name": "message",
 *           "type": "text",
 *           "required": true
 *         }
 *       ],
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a lead form
 * @route POST /admin/meta-ads/lead-forms
 * @group Meta Ads - Operations related to Meta Ads lead forms
 * @param {LeadFormInput} request.body.required - Lead form data to create
 * @returns {LeadFormResponse} 200 - Created lead form object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/meta-ads/lead-forms
 * {
 *   "platform_id": "meta_123456789",
 *   "name": "Contact Us",
 *   "description": "Form for users to contact us",
 *   "fields": [
 *     {
 *       "name": "email",
 *       "type": "email",
 *       "required": true
 *     },
 *     {
 *       "name": "message",
 *       "type": "text",
 *       "required": true
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "leadForm": {
 *     "id": "lead_form_123456789",
 *     "platform_id": "meta_123456789",
 *     "name": "Contact Us",
 *     "description": "Form for users to contact us",
 *     "fields": [
 *       {
 *         "name": "email",
 *         "type": "email",
 *         "required": true
 *       },
 *       {
 *         "name": "message",
 *         "type": "text",
 *         "required": true
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/lead-forms
 * 
 * List all lead forms
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { platform_id } = req.query as Record<string, string>
    
    const filters: Record<string, any> = {}
    if (platform_id) {
      filters.platform_id = platform_id
    }

    const leadForms = await socials.listLeadForms(filters)

    res.json({
      leadForms,
      count: leadForms.length,
    })
  } catch (error: any) {
    console.error("Failed to list lead forms:", error)
    res.status(500).json({
      message: "Failed to list lead forms",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/lead-forms
 * 
 * Create a lead form
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const leadForm = await socials.createLeadForms(body)

    res.json({ leadForm })
  } catch (error: any) {
    console.error("Failed to create lead form:", error)
    res.status(500).json({
      message: "Failed to create lead form",
      error: error.message,
    })
  }
}
