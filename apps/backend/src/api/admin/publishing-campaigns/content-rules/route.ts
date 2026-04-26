/**
 * @file Admin API routes for managing publishing campaign content rules
 * @description Provides endpoints for retrieving default content rule templates for social media platforms
 * @module API/Admin/PublishingCampaigns/ContentRules
 */

/**
 * @typedef {Object} ContentRule
 * @property {string} platform - The social media platform identifier
 * @property {Object} rule - The default content rule template for the platform
 * @property {string} rule.template - The content template with placeholders
 * @property {Object} rule.placeholders - Available placeholders and their descriptions
 * @property {Object} rule.settings - Platform-specific settings
 */

/**
 * @typedef {Object} ContentRulesResponse
 * @property {Object.<string, ContentRule>} rules - All available content rules by platform
 * @property {string[]} available_platforms - List of supported platform identifiers
 */

/**
 * @typedef {Object} SingleContentRuleResponse
 * @property {ContentRule} rule - The requested content rule for the specified platform
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} error - Error message describing what went wrong
 * @property {string[]} available_platforms - List of supported platform identifiers
 */

/**
 * Get available content rule templates
 * @route GET /admin/publishing-campaigns/content-rules
 * @group Publishing Campaigns - Operations related to publishing campaigns and content rules
 * @param {string} [platform] - Optional platform identifier to filter results
 * @returns {ContentRulesResponse} 200 - All available content rules when no platform is specified
 * @returns {SingleContentRuleResponse} 200 - Content rule for the specified platform
 * @throws {ErrorResponse} 404 - When the specified platform has no default rule
 *
 * @example request - Get all content rules
 * GET /admin/publishing-campaigns/content-rules
 *
 * @example response 200 - All content rules
 * {
 *   "rules": {
 *     "facebook": {
 *       "platform": "facebook",
 *       "rule": {
 *         "template": "Check out this product: {product_name} - {product_description}",
 *         "placeholders": {
 *           "product_name": "The name of the product",
 *           "product_description": "The description of the product"
 *         },
 *         "settings": {
 *           "max_length": 280,
 *           "supports_images": true
 *         }
 *       }
 *     },
 *     "twitter": {
 *       "platform": "twitter",
 *       "rule": {
 *         "template": "New product alert! {product_name} - {product_price}",
 *         "placeholders": {
 *           "product_name": "The name of the product",
 *           "product_price": "The price of the product"
 *         },
 *         "settings": {
 *           "max_length": 280,
 *           "supports_images": true
 *         }
 *       }
 *     }
 *   },
 *   "available_platforms": ["facebook", "twitter", "instagram", "linkedin"]
 * }
 *
 * @example request - Get content rule for specific platform
 * GET /admin/publishing-campaigns/content-rules?platform=instagram
 *
 * @example response 200 - Single content rule
 * {
 *   "rule": {
 *     "platform": "instagram",
 *     "rule": {
 *       "template": "📢 New arrival! {product_name}\n\n{product_description}\n\n#shopnow #newproduct",
 *       "placeholders": {
 *         "product_name": "The name of the product",
 *         "product_description": "The description of the product"
 *       },
 *       "settings": {
 *         "max_length": 2200,
 *         "supports_images": true,
 *         "supports_hashtags": true
 *       }
 *     }
 *   }
 * }
 *
 * @example request - Request for unsupported platform
 * GET /admin/publishing-campaigns/content-rules?platform=tiktok
 *
 * @example response 404 - Platform not found
 * {
 *   "error": "No default rule for platform: tiktok",
 *   "available_platforms": ["facebook", "twitter", "instagram", "linkedin"]
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEFAULT_CONTENT_RULES } from "../../../../modules/socials/types/publishing-automation"

/**
 * GET /admin/publishing-campaigns/content-rules
 * Get available content rule templates
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { platform } = req.query as { platform?: string }
  
  if (platform) {
    const normalizedPlatform = platform.toLowerCase()
    const rule = DEFAULT_CONTENT_RULES[normalizedPlatform]
    
    if (!rule) {
      return res.status(404).json({ 
        error: `No default rule for platform: ${platform}`,
        available_platforms: Object.keys(DEFAULT_CONTENT_RULES),
      })
    }
    
    return res.json({ rule })
  }
  
  return res.json({ 
    rules: DEFAULT_CONTENT_RULES,
    available_platforms: Object.keys(DEFAULT_CONTENT_RULES),
  })
}
