import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  createHook,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPostService from "../../modules/socials/service";
import FacebookService from "../../modules/social-provider/facebook-service";
import { extractHashtagsMentionsStep } from "./extract-hashtags-mentions";
import { decryptAccessToken } from "../../modules/socials/utils/token-helpers";

export type CreateSocialPostStepInput = {
  platform_id: string;
  name?: string;
  post_url?: string;
  caption?: string;
  status?: "draft" | "scheduled" | "posted" | "failed" | "archived";
  scheduled_at?: Date;
  posted_at?: Date;
  insights?: Record<string, unknown>;
  media_attachments?: Record<string, unknown>;
  notes?: string;
  error_message?: string;
  related_item_type?: string;
  related_item_id?: string;
  metadata?: Record<string, unknown> | null;
};

const normalizeInputStep = createStep(
  "normalize-create-social-post-input",
  async (input: any) => {
    const caption = input.caption ?? input.message ?? undefined
    const isVideo = (input.post_type || "").toLowerCase() === "reel"
    const mediaFromUrls: Record<string, any>[] = Array.isArray(input.media_urls)
      ? input.media_urls.map((url: string) => ({ type: isVideo ? "video" : "image", url }))
      : []
    const media = Array.isArray(input.media_attachments) ? input.media_attachments : mediaFromUrls

    // Preserve link in metadata for Facebook feed posts
    const metadata = input.metadata ?? {}
    if (input.link) {
      metadata.link = input.link
    }

    return new StepResponse({
      ...input,
      caption,
      media_attachments: media && media.length ? media : null,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    })
  }
)

const resolveDefaultPageStep = createStep(
  "resolve-default-page-id",
  async (input: any, { container }) => {
    const platformName = (input.platform_name || "").toLowerCase?.() || ""

    // Only resolve for Facebook if page_id not already provided
    if (platformName === "facebook") {
      const currentMeta = (input.metadata || {}) as Record<string, any>
      if (!currentMeta.page_id) {
        const service: SocialPostService = container.resolve(SOCIALS_MODULE)
        const [platform] = await service.listSocialPlatforms({ id: input.platform_id })
        const apiConfig = (platform as any)?.api_config
        
        if (apiConfig) {
          try {
            // Decrypt access token using helper
            const token = decryptAccessToken(apiConfig, container)
            const fb = new FacebookService()
            const pages = await fb.listManagedPages(token)
            const pageId = pages?.[0]?.id
            if (pageId) {
              return new StepResponse({ ...input, metadata: { ...currentMeta, page_id: pageId } })
            }
          } catch (error) {
            console.warn(`[Resolve Default Page] Failed to decrypt token or fetch pages: ${error.message}`)
          }
        }
      }
    }
    return new StepResponse(input)
  }
)

export type CreateSocialPostWorkflowInput = CreateSocialPostStepInput;

export const createSocialPostStep = createStep(
  "create-social-post-step",
  async (input: CreateSocialPostStepInput, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    const created = await service.createSocialPosts(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    await service.softDeleteSocialPosts(id);
  }
);

export const createSocialPostWorkflow = createWorkflow(
  "create-social-post",
  (input: CreateSocialPostWorkflowInput) => {
    // Normalize and enrich input via local steps before creation
    const normalized = normalizeInputStep(input)
    const enriched = resolveDefaultPageStep(normalized)

    const result = createSocialPostStep(enriched as any);
    
    // Extract hashtags and mentions from caption (async, doesn't block post creation)
    if (enriched.caption) {
      extractHashtagsMentionsStep({
        caption: enriched.caption,
        platform_name: (input as any).platform_name || "all",
      })
    }
    
    // Emit hook so listeners can react to social post creation
    const socialPostCreated = createHook(
      "socialPostCreated", 
      {
      post: result,
      }
  )

    return new WorkflowResponse(result, { hooks: [socialPostCreated] });
  }
);
