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
