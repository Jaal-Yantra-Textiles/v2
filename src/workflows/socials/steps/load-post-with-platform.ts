import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import SocialsService from "../../../modules/socials/service"

/**
 * Step 1: Load Post with Platform
 * 
 * Loads the social post by ID with its associated platform.
 * Validates that both post and platform exist.
 */
export const loadPostWithPlatformStep = createStep(
  "load-post-with-platform",
  async (input: { post_id: string }, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    const [post] = await socials.listSocialPosts(
      { id: input.post_id },
      { relations: ["platform"] }
    )

    if (!post) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Social post ${input.post_id} not found`
      )
    }

    const platform = (post as any).platform
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Post has no associated platform"
      )
    }

    console.log(`[Load Post] ✓ Loaded post ${input.post_id} with platform ${platform.name}`)

    return new StepResponse({ post, platform })
  }
)
