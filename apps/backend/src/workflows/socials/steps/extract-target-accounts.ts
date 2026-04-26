import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Step 5: Extract Target Accounts
 * 
 * Extracts target account IDs from post metadata with optional overrides.
 * This is a generic step that can handle any platform's account identifiers.
 * 
 * Supported accounts:
 * - page_id: Facebook Page ID
 * - ig_user_id: Instagram Business Account ID
 * - linkedin_org_id: LinkedIn Organization ID (future)
 * - tiktok_account_id: TikTok Account ID (future)
 * - youtube_channel_id: YouTube Channel ID (future)
 * 
 * Overrides take precedence over metadata values.
 * Returns all account IDs found in metadata or overrides.
 */
export const extractTargetAccountsStep = createStep(
  "extract-target-accounts",
  async (input: { 
    post: any
    overrides?: Record<string, string> // Generic overrides for any account type
    // Backward compatibility - specific overrides
    override_page_id?: string
    override_ig_user_id?: string
  }) => {
    const metadata = (input.post.metadata || {}) as Record<string, any>
    const overrides = input.overrides || {}
    
    // Extract all account identifiers from metadata
    const accounts: Record<string, string | undefined> = {}
    
    // Common account identifier keys to look for
    const accountKeys = [
      'page_id',           // Facebook
      'ig_user_id',        // Instagram
      'linkedin_org_id',   // LinkedIn
      'tiktok_account_id', // TikTok
      'youtube_channel_id',// YouTube
      'twitter_user_id',   // Twitter (if needed in future)
      'account_id',        // Generic fallback
    ]
    
    // Extract from metadata
    accountKeys.forEach(key => {
      if (metadata[key]) {
        accounts[key] = metadata[key] as string
      }
    })
    
    // Apply generic overrides
    Object.keys(overrides).forEach(key => {
      if (overrides[key]) {
        accounts[key] = overrides[key]
      }
    })
    
    // Apply specific overrides (backward compatibility)
    if (input.override_page_id) {
      accounts.page_id = input.override_page_id
    }
    if (input.override_ig_user_id) {
      accounts.ig_user_id = input.override_ig_user_id
    }
    
    // Log extracted accounts
    const accountSummary = Object.entries(accounts)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ')
    
    console.log(`[Extract Target Accounts] ✓ ${accountSummary || 'No accounts found'}`)

    return new StepResponse({
      accounts,
      // Backward compatibility - return specific fields
      page_id: accounts.page_id,
      ig_user_id: accounts.ig_user_id,
    })
  }
)
