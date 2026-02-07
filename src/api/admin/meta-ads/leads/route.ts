/**
 * @file Admin API routes for managing Meta Ads leads
 * @description Provides endpoints for creating and listing leads from Meta Ads in the JYT Commerce platform
 * @module API/Admin/MetaAds
 */

/**
 * @typedef {Object} LeadInput
 * @property {string} [email] - The email address of the lead
 * @property {string} [full_name] - The full name of the lead
 * @property {string} [first_name] - The first name of the lead
 * @property {string} [last_name] - The last name of the lead
 * @property {string} [company_name] - The company name of the lead
 * @property {string} [status] - The status of the lead (new, contacted, qualified, converted, etc.)
 * @property {string} [campaign_id] - The ID of the campaign associated with the lead
 * @property {string} [form_id] - The ID of the lead form
 * @property {string} [platform_id] - The ID of the platform
 * @property {Date} [created_time] - When the lead was created
 */

/**
 * @typedef {Object} LeadResponse
 * @property {string} id - The unique identifier of the lead
 * @property {string} [email] - The email address of the lead
 * @property {string} [full_name] - The full name of the lead
 * @property {string} [first_name] - The first name of the lead
 * @property {string} [last_name] - The last name of the lead
 * @property {string} [company_name] - The company name of the lead
 * @property {string} [status] - The status of the lead
 * @property {string} [campaign_id] - The ID of the campaign associated with the lead
 * @property {string} [form_id] - The ID of the lead form
 * @property {string} [platform_id] - The ID of the platform
 * @property {Date} created_time - When the lead was created
 */

/**
 * @typedef {Object} ListLeadsResponse
 * @property {LeadResponse[]} leads - Array of lead objects
 * @property {number} count - Number of leads returned in this response
 * @property {number} total - Total number of leads matching the filters
 * @property {number} limit - Number of results per page
 * @property {number} offset - Pagination offset
 */

/**
 * List all leads with optional filters
 * @route GET /admin/meta-ads/leads
 * @group MetaAds - Operations related to Meta Ads leads
 * @param {string} [status] - Filter by status (new, contacted, qualified, converted, etc.)
 * @param {string} [campaign_id] - Filter by campaign ID
 * @param {string} [form_id] - Filter by lead form ID
 * @param {string} [platform_id] - Filter by platform ID
 * @param {string} [since] - Filter leads created after this date (ISO format)
 * @param {string} [until] - Filter leads created before this date (ISO format)
 * @param {string} [q] - Search by email or name
 * @param {number} [limit=50] - Number of results per page
 * @param {number} [offset=0] - Pagination offset
 * @returns {ListLeadsResponse} 200 - Paginated list of leads with filtering options
 * @throws {MedusaError} 500 - Internal server error when listing leads fails
 *
 * @example request
 * GET /admin/meta-ads/leads?status=new&campaign_id=camp_123&limit=10&offset=0
 *
 * @example response 200
 * {
 *   "leads": [
 *     {
 *       "id": "lead_123456789",
 *       "email": "john.doe@example.com",
 *       "full_name": "John Doe",
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "company_name": "Acme Inc",
 *       "status": "new",
 *       "campaign_id": "camp_123",
 *       "form_id": "form_456",
 *       "platform_id": "meta",
 *       "created_time": "2023-01-15T10:30:00Z"
 *     }
 *   ],
 *   "count": 1,
 *   "total": 5,
 *   "limit": 10,
 *   "offset": 0
 * }
 */

/**
 * Create a new lead
 * @route POST /admin/meta-ads/leads
 * @group MetaAds - Operations related to Meta Ads leads
 * @param {LeadInput} request.body.required - Lead data to create
 * @returns {Object} 200 - Created lead object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error when creating lead fails
 *
 * @example request
 * POST /admin/meta-ads/leads
 * {
 *   "email": "jane.smith@example.com",
 *   "full_name": "Jane Smith",
 *   "first_name": "Jane",
 *   "last_name": "Smith",
 *   "company_name": "Globex Corp",
 *   "status": "new",
 *   "campaign_id": "camp_789",
 *   "form_id": "form_101",
 *   "platform_id": "meta",
 *   "created_time": "2023-02-20T14:45:00Z"
 * }
 *
 * @example response 200
 * {
 *   "lead": {
 *     "id": "lead_987654321",
 *     "email": "jane.smith@example.com",
 *     "full_name": "Jane Smith",
 *     "first_name": "Jane",
 *     "last_name": "Smith",
 *     "company_name": "Globex Corp",
 *     "status": "new",
 *     "campaign_id": "camp_789",
 *     "form_id": "form_101",
 *     "platform_id": "meta",
 *     "created_time": "2023-02-20T14:45:00Z"
 *   }
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/leads
 * 
 * List all leads with optional filters
 * 
 * Query params:
 * - status: Filter by status (new, contacted, qualified, converted, etc.)
 * - campaign_id: Filter by campaign
 * - form_id: Filter by lead form
 * - platform_id: Filter by platform
 * - since: Filter leads created after this date
 * - until: Filter leads created before this date
 * - q: Search by email or name
 * - limit: Number of results (default 50)
 * - offset: Pagination offset
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    
    const {
      status,
      campaign_id,
      form_id,
      platform_id,
      since,
      until,
      q,
      limit = "50",
      offset = "0",
    } = req.query as Record<string, string>

    // Build filters
    const filters: Record<string, any> = {}
    
    if (status) {
      filters.status = status
    }
    if (campaign_id) {
      filters.campaign_id = campaign_id
    }
    if (form_id) {
      filters.form_id = form_id
    }
    if (platform_id) {
      filters.platform_id = platform_id
    }

    // Get leads
    const leads = await socials.listLeads(filters, {
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
      order: { created_time: "DESC" },
    })

    // Apply additional filters in code (date range, search)
    let filteredLeads = leads

    if (since) {
      const sinceDate = new Date(since)
      filteredLeads = filteredLeads.filter(
        (lead: any) => new Date(lead.created_time) >= sinceDate
      )
    }

    if (until) {
      const untilDate = new Date(until)
      filteredLeads = filteredLeads.filter(
        (lead: any) => new Date(lead.created_time) <= untilDate
      )
    }

    if (q) {
      const query = q.toLowerCase()
      filteredLeads = filteredLeads.filter((lead: any) => 
        lead.email?.toLowerCase().includes(query) ||
        lead.full_name?.toLowerCase().includes(query) ||
        lead.first_name?.toLowerCase().includes(query) ||
        lead.last_name?.toLowerCase().includes(query) ||
        lead.company_name?.toLowerCase().includes(query)
      )
    }

    // Get total count for pagination
    const allLeads = await socials.listLeads(filters)
    
    res.json({
      leads: filteredLeads,
      count: filteredLeads.length,
      total: allLeads.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    })
  } catch (error: any) {
    console.error("Failed to list leads:", error)
    res.status(500).json({
      message: "Failed to list leads",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/leads
 * 
 * Create a lead
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const lead = await socials.createLeads(body)

    res.json({ lead })
  } catch (error: any) {
    console.error("Failed to create lead:", error)
    res.status(500).json({
      message: "Failed to create lead",
      error: error.message,
    })
  }
}
