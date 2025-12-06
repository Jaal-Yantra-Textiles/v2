import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import MetaAdsService from "../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../modules/socials/utils/token-helpers"

/**
 * GET /webhooks/social/facebook
 * 
 * Facebook webhook verification endpoint
 * 
 * Facebook sends a GET request with these query parameters:
 * - hub.mode: "subscribe"
 * - hub.challenge: Random string to echo back
 * - hub.verify_token: Token to verify it's Facebook
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const mode = req.query["hub.mode"]
  const token = req.query["hub.verify_token"]
  const challenge = req.query["hub.challenge"]

  const verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN

  if (!verifyToken) {
    console.error("FACEBOOK_WEBHOOK_VERIFY_TOKEN not configured")
    return res.status(500).send("Webhook verification token not configured")
  }

  // Check if mode and token are correct
  if (mode === "subscribe" && token === verifyToken) {
    console.log("Webhook verified successfully")
    // Respond with the challenge token from the request
    return res.status(200).send(challenge)
  }

  console.error("Webhook verification failed:", { mode, token })
  return res.status(403).send("Forbidden")
}

/**
 * POST /webhooks/social/facebook
 * 
 * Facebook webhook event receiver
 * 
 * Receives real-time updates about:
 * - Post insights (reach, engagement, impressions)
 * - Comments and reactions
 * - Post status changes
 * - Media updates
 * 
 * Security:
 * - Validates X-Hub-Signature-256 header
 * - Verifies request is from Facebook
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const signature = req.headers["x-hub-signature-256"] as string | undefined
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET

  if (!appSecret) {
    console.error("FACEBOOK_CLIENT_SECRET not configured")
    return res.status(500).send("Webhook not configured")
  }

  // Validate signature
  if (!signature) {
    console.error("No signature provided")
    return res.status(401).send("Unauthorized")
  }

  // Read raw body for signature validation
  let rawBody = '';
  
  // Collect raw body chunks
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk) => {
      rawBody += chunk.toString('utf8');
    });
    req.on('end', () => resolve());
    req.on('error', (err) => reject(err));
  });
  
  // Calculate expected signature
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, 'utf8')
    .digest("hex")

  const isValid = `sha256=${expectedSignature}` === signature

  if (!isValid) {
    console.error("Invalid signature", {
      received: signature,
      expected: `sha256=${expectedSignature}`,
      bodyLength: rawBody.length,
      bodyPreview: rawBody.substring(0, 100)
    })
    return res.status(401).send("Unauthorized")
  }

  // Signature is valid - parse the body
  const body = JSON.parse(rawBody) as FacebookWebhookPayload

  console.log("Webhook received:", {
    object: body.object,
    entries: body.entry?.length || 0,
    timestamp: Date.now(),
  })

  // Return 200 OK immediately (Facebook requires response within 20 seconds)
  res.status(200).send("EVENT_RECEIVED")

  // Process webhook asynchronously
  processWebhookEvent(req.scope, body).catch((error) => {
    console.error("Failed to process webhook event:", error)
  })
}

/**
 * Process webhook event asynchronously
 */
async function processWebhookEvent(
  scope: any,
  payload: FacebookWebhookPayload
): Promise<void> {
  const socials = scope.resolve(SOCIALS_MODULE) as SocialsService

  // Handle different object types
  if (payload.object === "page") {
    await processPageEvents(socials, scope, payload.entry)
  } else if (payload.object === "instagram") {
    await processInstagramEvents(socials, payload.entry)
  } else {
    console.warn("Unsupported webhook object type:", payload.object)
  }
}

/**
 * Process Facebook Page webhook events
 */
async function processPageEvents(
  socials: SocialsService,
  scope: any,
  entries: FacebookWebhookEntry[]
): Promise<void> {
  for (const entry of entries) {
    const pageId = entry.id
    console.log("Processing page event:", { pageId, changes: entry.changes?.length })

    for (const change of entry.changes || []) {
      try {
        if (change.field === "feed") {
          await handleFeedChange(socials, pageId, change.value)
        } else if (change.field === "posts") {
          await handlePostInsights(socials, pageId, change.value)
        } else if (change.field === "comments") {
          await handleComment(socials, pageId, change.value)
        } else if (change.field === "reactions") {
          await handleReaction(socials, pageId, change.value)
        } else if (change.field === "leadgen") {
          await handleLeadgenEvent(socials, scope, pageId, change.value)
        } else {
          console.log("Unhandled page field:", change.field)
        }
      } catch (error) {
        console.error("Failed to process page change:", error)
      }
    }
  }
}

/**
 * Process Instagram webhook events
 */
async function processInstagramEvents(
  socials: SocialsService,
  entries: FacebookWebhookEntry[]
): Promise<void> {
  for (const entry of entries) {
    const igUserId = entry.id
    console.log("Processing Instagram event:", { igUserId, changes: entry.changes?.length })

    for (const change of entry.changes || []) {
      try {
        if (change.field === "comments") {
          await handleInstagramComment(socials, igUserId, change.value)
        } else if (change.field === "mentions") {
          await handleInstagramMention(socials, igUserId, change.value)
        } else if (change.field === "media") {
          await handleInstagramMediaInsights(socials, igUserId, change.value)
        } else {
          console.log("Unhandled Instagram field:", change.field)
        }
      } catch (error) {
        console.error("Failed to process Instagram change:", error)
      }
    }
  }
}

/**
 * Handle Facebook feed changes (new posts, updates, deletes)
 */
async function handleFeedChange(
  socials: SocialsService,
  pageId: string,
  value: any
): Promise<void> {
  const postId = value.post_id
  const verb = value.verb // "add", "edited", "remove"

  console.log("Feed change:", { pageId, postId, verb })

  // Find the social post by Facebook post ID
  const [post] = await socials.listSocialPosts({
    insights: {
      facebook_post_id: postId,
    } as any,
  })

  if (!post) {
    console.log("Post not found in database:", postId)
    return
  }

  // Update post based on verb
  if (verb === "remove") {
    await socials.updateSocialPosts([
      {
        selector: { id: post.id },
        data: {
          status: "archived" as const,
          insights: {
            ...(post.insights as Record<string, unknown>),
            deleted_at: new Date().toISOString(),
          },
        },
      },
    ])
  } else if (verb === "edited") {
    await socials.updateSocialPosts([
      {
        selector: { id: post.id },
        data: {
          insights: {
            ...(post.insights as Record<string, unknown>),
            edited_at: new Date().toISOString(),
            message: value.message,
          },
        },
      },
    ])
  }
}

/**
 * Handle post insights updates
 */
async function handlePostInsights(
  socials: SocialsService,
  pageId: string,
  value: any
): Promise<void> {
  const postId = value.post_id
  const insights = value.insights || {}

  console.log("Post insights:", { pageId, postId, insights })

  // Find the social post
  const [post] = await socials.listSocialPosts({
    insights: {
      facebook_post_id: postId,
    } as any,
  })

  if (!post) {
    console.log("Post not found in database:", postId)
    return
  }

  // Update post with insights
  await socials.updateSocialPosts([
    {
      selector: { id: post.id },
      data: {
        insights: {
          ...(post.insights as Record<string, unknown>),
          facebook_insights: {
            ...((post.insights as Record<string, unknown>)?.facebook_insights || {}),
            ...insights,
            last_updated: new Date().toISOString(),
          },
        },
      },
    },
  ])
}

/**
 * Handle new comments on Facebook posts
 */
async function handleComment(
  socials: SocialsService,
  pageId: string,
  value: any
): Promise<void> {
  const postId = value.post_id
  const commentId = value.comment_id
  const message = value.message
  const from = value.from

  console.log("New comment:", { pageId, postId, commentId, from })

  // Find the social post
  const [post] = await socials.listSocialPosts({
    insights: {
      facebook_post_id: postId,
    } as any,
  })

  if (!post) {
    console.log("Post not found in database:", postId)
    return
  }

  // Update post with comment count
  const currentInsights = (post.insights as Record<string, unknown>) || {}
  const comments = (currentInsights.comments as any[]) || []
  
  await socials.updateSocialPosts([
    {
      selector: { id: post.id },
      data: {
        insights: {
          ...currentInsights,
          comments: [
            ...comments,
            {
              id: commentId,
              message,
              from,
              created_at: new Date().toISOString(),
            },
          ],
          comment_count: comments.length + 1,
        },
      },
    },
  ])
}

/**
 * Handle reactions on Facebook posts
 */
async function handleReaction(
  socials: SocialsService,
  pageId: string,
  value: any
): Promise<void> {
  const postId = value.post_id
  const reactionType = value.reaction_type // "like", "love", "wow", etc.

  console.log("New reaction:", { pageId, postId, reactionType })

  // Find the social post
  const [post] = await socials.listSocialPosts({
    insights: {
      facebook_post_id: postId,
    } as any,
  })

  if (!post) {
    console.log("Post not found in database:", postId)
    return
  }

  // Update post with reaction
  const currentInsights = (post.insights as Record<string, unknown>) || {}
  const reactions = (currentInsights.reactions as Record<string, number>) || {}
  
  await socials.updateSocialPosts([
    {
      selector: { id: post.id },
      data: {
        insights: {
          ...currentInsights,
          reactions: {
            ...reactions,
            [reactionType]: (reactions[reactionType] || 0) + 1,
          },
          reaction_count: Object.values({
            ...reactions,
            [reactionType]: (reactions[reactionType] || 0) + 1,
          }).reduce((a: any, b: any) => a + b, 0),
        },
      },
    },
  ])
}

/**
 * Handle Instagram comments
 */
async function handleInstagramComment(
  socials: SocialsService,
  igUserId: string,
  value: any
): Promise<void> {
  const mediaId = value.media_id
  const commentId = value.id
  const text = value.text

  console.log("Instagram comment:", { igUserId, mediaId, commentId })

  // Find the social post
  const [post] = await socials.listSocialPosts({
    insights: {
      instagram_media_id: mediaId,
    } as any,
  })

  if (!post) {
    console.log("Post not found in database:", mediaId)
    return
  }

  // Update post with comment
  const currentInsights = (post.insights as Record<string, unknown>) || {}
  const comments = (currentInsights.instagram_comments as any[]) || []
  
  await socials.updateSocialPosts([
    {
      selector: { id: post.id },
      data: {
        insights: {
          ...currentInsights,
          instagram_comments: [
            ...comments,
            {
              id: commentId,
              text,
              created_at: new Date().toISOString(),
            },
          ],
          instagram_comment_count: comments.length + 1,
        },
      },
    },
  ])
}

/**
 * Handle leadgen events (new leads from lead ads)
 * 
 * This is triggered when a user submits a lead form.
 * The webhook only contains the lead ID - we need to fetch full details from API.
 */
async function handleLeadgenEvent(
  socials: SocialsService,
  scope: any,
  pageId: string,
  value: any
): Promise<void> {
  const leadgenId = value.leadgen_id
  const formId = value.form_id
  const adId = value.ad_id
  const adgroupId = value.adgroup_id // This is the adset ID
  const createdTime = value.created_time

  console.log("Leadgen event received:", { 
    pageId, 
    leadgenId, 
    formId, 
    adId, 
    adgroupId,
    createdTime 
  })

  try {
    // Find the platform for this page to get access token
    const platforms = await socials.listSocialPlatforms({})
    
    let accessToken: string | null = null
    let platformId: string | null = null
    
    for (const platform of platforms) {
      const apiConfig = platform.api_config as any
      if (!apiConfig) continue
      
      // Check if this platform has the page
      const pages = apiConfig.metadata?.pages || []
      const hasPage = pages.some((p: any) => p.id === pageId)
      
      if (hasPage) {
        // Get access token using the helper
        try {
          accessToken = decryptAccessToken(apiConfig, scope)
          platformId = platform.id
          break
        } catch (e) {
          console.warn(`Failed to get access token for platform ${platform.id}:`, e)
          continue
        }
      }
    }

    if (!accessToken || !platformId) {
      console.error("No access token found for page:", pageId)
      return
    }

    // Fetch full lead details from Meta API
    const metaAds = new MetaAdsService()
    const leadData = await metaAds.getLead(leadgenId, accessToken)

    console.log("Lead data fetched:", {
      id: leadData.id,
      fields: leadData.field_data?.length,
      campaign: leadData.campaign_name,
      ad: leadData.ad_name,
    })

    // Extract contact info from field_data
    const contactInfo = metaAds.extractLeadContactInfo(leadData.field_data || [])

    // Check if lead already exists
    const existingLeads = await socials.listLeads({
      meta_lead_id: leadgenId,
    })

    if (existingLeads.length > 0) {
      console.log("Lead already exists:", leadgenId)
      return
    }

    // Create the lead in our database
    await socials.createLeads({
      meta_lead_id: leadgenId,
      
      // Contact info
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
      
      // Form data - convert array to object for JSON storage
      field_data: leadData.field_data as unknown as Record<string, unknown>,
      
      // Source tracking
      ad_id: leadData.ad_id || adId || null,
      ad_name: leadData.ad_name || null,
      adset_id: leadData.adset_id || adgroupId || null,
      adset_name: leadData.adset_name || null,
      campaign_id: leadData.campaign_id || null,
      campaign_name: leadData.campaign_name || null,
      form_id: leadData.form_id || formId || null,
      page_id: pageId,
      source_platform: leadData.platform || "facebook",
      
      // Timestamps
      created_time: new Date(leadData.created_time),
      
      // Status
      status: "new" as const,
      
      // Relationships
      platform_id: platformId,
      
      // Metadata
      metadata: {
        raw_response: leadData,
        is_organic: leadData.is_organic,
        retailer_item_id: leadData.retailer_item_id,
        webhook_received_at: new Date().toISOString(),
      },
    } as any)

    console.log("Lead created successfully:", leadgenId)

    // TODO: Trigger notification workflow (email, Slack, etc.)
    // TODO: Create Person record if needed

  } catch (error) {
    console.error("Failed to process leadgen event:", error)
    throw error
  }
}

/**
 * Handle Instagram mentions
 */
async function handleInstagramMention(
  socials: SocialsService,
  igUserId: string,
  value: any
): Promise<void> {
  const mediaId = value.media_id
  const commentId = value.comment_id

  console.log("Instagram mention:", { igUserId, mediaId, commentId })

  // You can implement mention tracking here
}

/**
 * Handle Instagram media insights (impressions, reach, engagement)
 */
async function handleInstagramMediaInsights(
  socials: SocialsService,
  igUserId: string,
  value: any
): Promise<void> {
  const mediaId = value.media_id
  const insights = value.insights || {}

  console.log("Instagram media insights:", { igUserId, mediaId, insights })

  // Find the social post by Instagram media ID
  const [post] = await socials.listSocialPosts({
    insights: {
      instagram_media_id: mediaId,
    } as any,
  })

  if (!post) {
    console.log("Post not found in database:", mediaId)
    return
  }

  // Update post with Instagram insights
  const currentInsights = (post.insights as Record<string, unknown>) || {}
  
  await socials.updateSocialPosts([
    {
      selector: { id: post.id },
      data: {
        insights: {
          ...currentInsights,
          instagram_insights: {
            ...((currentInsights.instagram_insights as Record<string, unknown>) || {}),
            ...insights,
            last_updated: new Date().toISOString(),
          },
        },
      },
    },
  ])
}

// Type definitions
interface FacebookWebhookPayload {
  object: "page" | "instagram"
  entry: FacebookWebhookEntry[]
}

interface FacebookWebhookEntry {
  id: string
  time: number
  changes?: FacebookWebhookChange[]
}

interface FacebookWebhookChange {
  field: string
  value: any
}
