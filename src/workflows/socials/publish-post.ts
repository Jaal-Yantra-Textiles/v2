import { MedusaError } from "@medusajs/utils"
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowData,
  WorkflowResponse,
  transform,
} from "@medusajs/workflows-sdk"
import { SOCIALS_MODULE } from "../../modules/socials"
import SocialsService from "../../modules/socials/service"
import FacebookService from "../../modules/social-provider/facebook-service"
import InstagramService from "../../modules/social-provider/instagram-service"

interface PublishPostInput {
  post_id: string
  page_id?: string
}

interface LoadedPost {
  id: string
  caption?: string | null
  media_attachments?: any
  metadata?: Record<string, any> | null
  platform_id?: string | null
  platform?: { id: string; name?: string | null; api_config?: Record<string, any> | null } | null
  post_url?: string | null
}

// Types for Facebook publish results
type FbApiResponse = { id?: string; [k: string]: any }
type FacebookPublishPhotoResult = { kind: "photo"; url: string; response: FbApiResponse }
type FacebookPublishFeedResult = { kind: "feed"; link?: string; response: FbApiResponse }
type PublishResult = FacebookPublishPhotoResult | FacebookPublishFeedResult

const loadPostStep = createStep(
  "load-social-post",
  async (input: PublishPostInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const [post] = await socials.listSocialPosts(
      { id: input.post_id },
      { relations: ["platform"] }
    )
    if (!post) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `SocialPost ${input.post_id} not found`)
    }
    return new StepResponse(post as unknown as LoadedPost)
  }
)

const resolvePageIdStep = createStep(
  "resolve-facebook-page-id-if-needed",
  async (
    input: { post: LoadedPost; override_page_id?: string }
  ) => {
    const providerName = (input.post.platform?.name || "").toLowerCase()
    if (providerName !== "facebook") {
      return new StepResponse<{ pageId?: string }>({})
    }
    const pageId = input.override_page_id || (input.post.metadata && (input.post.metadata as any).page_id)
    if (!pageId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing page_id (not provided and not found in post.metadata.page_id)"
      )
    }
    return new StepResponse({ pageId })
  }
)

const resolveIgUserStep = createStep(
  "resolve-ig-user",
  async (input: { post: LoadedPost }) => {
    const providerName = (input.post.platform?.name || "").toLowerCase()
    if (providerName !== "instagram") {
      return new StepResponse<{ igUserId?: string }>({})
    }
    const fromMeta = (input.post.metadata && (input.post.metadata as any).ig_user_id) as string | undefined
    if (fromMeta) {
      return new StepResponse({ igUserId: fromMeta })
    }
    const igs = ((input.post.platform?.api_config as any)?.metadata?.ig_accounts || []) as Array<{ id: string }>
    if (Array.isArray(igs) && igs.length === 1) {
      return new StepResponse({ igUserId: igs[0].id })
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing ig_user_id (not provided in post.metadata and cannot infer a single account from platform metadata)"
    )
  }
)

const resolveTokensStep = createStep(
  "resolve-provider-tokens",
  async (
    input: { post: LoadedPost; pageId?: string },
    { container }
  ) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    const platformId = input.post.platform_id || input.post.platform?.id
    if (!platformId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Post has no associated platform")
    }

    const [platform] = await socials.listSocialPlatforms({ id: platformId })
    if (!platform) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `SocialPlatform ${platformId} not found`)
    }

    const providerName = (platform as any).name?.toLowerCase?.() || ""

    const userAccessToken = (platform as any).api_config?.access_token as string | undefined
    if (!userAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No user access token found in platform api_config"
      )
    }

    if (providerName === "facebook") {
      if (!input.pageId) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing pageId for Facebook publish")
      }
      const fb = new FacebookService()
      const pageAccessToken = await fb.getPageAccessToken(input.pageId, userAccessToken)
      return new StepResponse({ providerName, accessToken: pageAccessToken })
    }

    if (providerName === "instagram") {
      // For IG we use the user access token directly
      return new StepResponse({ providerName, accessToken: userAccessToken })
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unsupported provider for this workflow: ${providerName}`
    )
  }
)

const publishStep = createStep(
  "publish-post",
  async (
    input: { post: LoadedPost; providerName: string; pageId?: string; fbAccessToken?: string; igAccessToken?: string; igUserId?: string }
  ) => {
    const message = input.post.caption || undefined
    const attachments = (input.post.media_attachments as Record<string, any>[] | undefined) || []

    if (input.providerName === "facebook") {
      const fb = new FacebookService()
      const results: PublishResult[] = []
      const imageAttachments = attachments.filter((a) => a && a.type === "image" && a.url) as { url: string; type: string }[]
      for (const att of imageAttachments) {
        const r = await fb.createPagePhotoPost(input.pageId!, { message, image_url: att.url }, input.fbAccessToken!)
        results.push({ kind: "photo", url: att.url, response: r })
      }
      
      // Extract link from metadata or media_attachments
      const linkFromMetadata = input.post.metadata?.link as string | undefined
      const linkAttachment = attachments.find((a) => a && a.type === "link" && a.url) as { url?: string } | undefined
      const linkUrl = linkFromMetadata || linkAttachment?.url
      
      if (!imageAttachments.length) {
        if (linkUrl || message) {
          const r = await fb.createPageFeedPost(input.pageId!, { message: message || "", link: linkUrl }, input.fbAccessToken!)
          results.push({ kind: "feed", link: linkUrl, response: r })
        }
      }
      return new StepResponse(results)
    }

    if (input.providerName === "instagram") {
      const ig = new InstagramService()
      const results: any[] = []
      const imageAttachments = attachments.filter((a) => a && a.type === "image" && a.url) as { url: string; type: string }[]
      const videoAttachments = attachments.filter((a) => a && a.type === "video" && a.url) as { url: string; type: string }[]

      for (const att of imageAttachments) {
        const r = await ig.publishImage(input.igUserId!, { image_url: att.url, caption: message }, input.igAccessToken!)
        results.push({ kind: "ig_image", url: att.url, response: r })
      }
      for (const att of videoAttachments) {
        const r = await ig.publishVideoAsReel(input.igUserId!, { video_url: att.url, caption: message }, input.igAccessToken!)
        results.push({ kind: "ig_reel", url: att.url, response: r })
      }
      return new StepResponse(results)
    }

    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unsupported provider in publish step: ${input.providerName}`)
  }
)

const updatePostStep = createStep(
  "update-social-post-after-publish",
  async (
    input: { post: LoadedPost; results: PublishResult[] },
    { container }
  ) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    const firstResponse = input.results?.[0]?.response as FbApiResponse | undefined
    const fbId = firstResponse?.id

    const [updated] = await socials.updateSocialPosts([
      {
        selector: { id: input.post.id },
        data: {
          status: "posted",
          posted_at: new Date(),
          post_url: fbId ? `https://www.facebook.com/${fbId}` : input.post.post_url || null,
          insights: input.results ? { publish_results: input.results } : null,
        },
      },
    ])

    return new StepResponse(updated)
  }
)

export const publishSocialPostWorkflow = createWorkflow(
  "publish-social-post-workflow",
  function (input: WorkflowData<PublishPostInput>) {
    const post = loadPostStep(input)

    const providerName = transform(post, (p) => (p.platform?.name || "").toLowerCase())

    const pageInfo = resolvePageIdStep({ post, override_page_id: input.page_id })
    const igUser = resolveIgUserStep({ post })

    // Resolve tokens once; step will gate logic by provider
    const tokens = resolveTokensStep({ post, pageId: transform(pageInfo, (p) => p.pageId) })

    const results = publishStep({
      post,
      providerName,
      pageId: transform(pageInfo, (p) => p.pageId),
      fbAccessToken: transform(tokens, (t) => (t as any).providerName === "facebook" ? (t as any).accessToken : undefined),
      igAccessToken: transform(tokens, (t) => (t as any).providerName === "instagram" ? (t as any).accessToken : undefined),
      igUserId: transform(igUser, (i) => i.igUserId),
    })

    const updated = updatePostStep({ post, results })

    return new WorkflowResponse(updated)
  }
)
