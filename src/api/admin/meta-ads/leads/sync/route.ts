import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import MetaAdsService from "../../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../../modules/socials/utils/token-helpers"

/**
 * POST /admin/meta-ads/leads/sync
 * 
 * Sync leads from Meta for a specific form or all forms
 * 
 * Body:
 * - platform_id: Platform ID to sync from (required)
 * - form_id: Specific form ID to sync (optional - syncs all if not provided)
 * - since: Sync leads created after this date (optional)
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const { platform_id, form_id, since } = body

    if (!platform_id) {
      return res.status(400).json({
        message: "platform_id is required",
      })
    }

    // Get platform and access token
    const platform = await socials.retrieveSocialPlatform(platform_id)
    
    if (!platform) {
      return res.status(404).json({
        message: "Platform not found",
      })
    }

    const apiConfig = platform.api_config as any
    if (!apiConfig) {
      return res.status(400).json({
        message: "Platform has no API configuration",
      })
    }

    // Get access token
    const accessToken = decryptAccessToken(apiConfig, req.scope)
    
    if (!accessToken) {
      return res.status(400).json({
        message: "No access token available",
      })
    }

    const metaAds = new MetaAdsService()
    const results = {
      synced: 0,
      skipped: 0,
      errors: 0,
      forms_processed: 0,
    }

    // Get forms to sync
    let formsToSync: string[] = []
    
    if (form_id) {
      formsToSync = [form_id]
    } else {
      // Get all pages and their forms
      const pages = apiConfig.metadata?.pages || []
      
      for (const page of pages) {
        try {
          // Get page access token
          const pageToken = page.access_token || accessToken
          const forms = await metaAds.listLeadForms(page.id, pageToken)
          formsToSync.push(...forms.map(f => f.id))
        } catch (error) {
          console.error(`Failed to get forms for page ${page.id}:`, error)
        }
      }
    }

    console.log(`Syncing leads from ${formsToSync.length} forms`)

    // Sync leads from each form
    for (const formId of formsToSync) {
      try {
        results.forms_processed++
        
        // Get leads from Meta
        const { leads } = await metaAds.getLeads(formId, accessToken, {
          since: since ? new Date(since) : undefined,
          limit: 500,
        })

        for (const leadData of leads) {
          try {
            // Check if lead already exists
            const existingLeads = await socials.listLeads({
              meta_lead_id: leadData.id,
            })

            if (existingLeads.length > 0) {
              results.skipped++
              continue
            }

            // Extract contact info
            const contactInfo = metaAds.extractLeadContactInfo(leadData.field_data || [])

            // Create lead
            await socials.createLeads({
              meta_lead_id: leadData.id,
              
              email: contactInfo.email || null,
              phone: contactInfo.phone || null,
              full_name: contactInfo.full_name || null,
              first_name: contactInfo.first_name || null,
              last_name: contactInfo.last_name || null,
              company_name: contactInfo.company_name || null,
              job_title: contactInfo.job_title || null,
              city: contactInfo.city || null,
              state: contactInfo.state || null,
              country: contactInfo.country || null,
              zip_code: contactInfo.zip_code || null,
              
              field_data: leadData.field_data as any,
              
              ad_id: leadData.ad_id || null,
              ad_name: leadData.ad_name || null,
              adset_id: leadData.adset_id || null,
              adset_name: leadData.adset_name || null,
              campaign_id: leadData.campaign_id || null,
              campaign_name: leadData.campaign_name || null,
              form_id: leadData.form_id || formId,
              source_platform: leadData.platform || "facebook",
              
              created_time: new Date(leadData.created_time),
              status: "new" as const,
              platform_id: platform_id,
              
              metadata: {
                raw_response: leadData,
                is_organic: leadData.is_organic,
                synced_at: new Date().toISOString(),
              },
            } as any)

            results.synced++
          } catch (error) {
            console.error(`Failed to create lead ${leadData.id}:`, error)
            results.errors++
          }
        }
      } catch (error) {
        console.error(`Failed to sync leads from form ${formId}:`, error)
        results.errors++
      }
    }

    res.json({
      message: "Lead sync completed",
      results,
    })
  } catch (error: any) {
    console.error("Failed to sync leads:", error)
    res.status(500).json({
      message: "Failed to sync leads",
      error: error.message,
    })
  }
}
