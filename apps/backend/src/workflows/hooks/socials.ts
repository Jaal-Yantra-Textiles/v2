import { createWorkflow, createStep, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import FacebookService from "../../modules/social-provider/facebook-service"
import SocialsService from "../../modules/socials/service"
import { SOCIALS_MODULE } from "../../modules/socials"

export type NormalizedCreateInput = {
  platform_id: string
  caption?: string
  media_attachments?: Record<string, any>[] | null
  metadata?: Record<string, any> | null
}

// Workflow: normalize create payload (accepts raw input, returns normalized fields)
export const normalizeCreateSocialPostInputWorkflow = createWorkflow(
  "normalize-create-social-post-input-workflow",
  (raw: any) => {
    const step = createStep(
      "normalize-create-social-post-input-step",
      async (input: any) => {
        const caption = input.caption ?? input.message ?? undefined
        const mediaFromUrls: Record<string, any>[] = Array.isArray(input.media_urls)
          ? input.media_urls.map((url: string) => ({ type: "image", url }))
          : []
        const media = Array.isArray(input.media_attachments) ? input.media_attachments : mediaFromUrls

        const normalized: NormalizedCreateInput = {
          platform_id: input.platform_id,
          caption,
          media_attachments: media.length ? media : null,
          metadata: input.metadata ?? null,
        }

        return new StepResponse({ ...input, ...normalized })
      }
    )

    const res = step(raw)
    return new WorkflowResponse(res)
  }
)

// Workflow: resolve default Facebook page_id (if not present in metadata)
export const resolveDefaultFacebookPageIdWorkflow = createWorkflow(
  "resolve-default-facebook-page-id-workflow",
  (input: { platform_id: string; metadata?: Record<string, any> | null }) => {
    const step = createStep(
      "resolve-default-facebook-page-id-step",
      async (data: { platform_id: string; metadata?: Record<string, any> | null }, { container }) => {
        const currentMeta = (data.metadata || {}) as Record<string, any>
        if (currentMeta.page_id) {
          return new StepResponse({ ...data, metadata: currentMeta })
        }

        const socials = container.resolve(SOCIALS_MODULE) as SocialsService
        const [platform] = await socials.listSocialPlatforms({ id: data.platform_id })
        if (!platform) {
          return new StepResponse({ ...data, metadata: currentMeta })
        }

        const token = (platform as any).api_config?.access_token as string | undefined
        if (!token) {
          return new StepResponse({ ...data, metadata: currentMeta })
        }

        const fb = new FacebookService()
        const pages = await fb.listManagedPages(token)
        const page_id = pages?.[0]?.id
        return new StepResponse({ ...data, metadata: { ...currentMeta, ...(page_id ? { page_id } : {}) } })
      }
    )

    const res = step(input as any)
    return new WorkflowResponse(res)
  }
)
