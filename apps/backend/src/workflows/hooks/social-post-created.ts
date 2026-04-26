import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { createSocialPostWorkflow } from "../socials/create-social-post"
import { publishSocialPostWorkflow } from "../socials/publish-post"

/**
 * Hook listener for when a SocialPost is created.
 * Add follow-up actions here (e.g., auto-schedule, analytics enqueue, notifications, etc.).
 */
createSocialPostWorkflow.hooks.socialPostCreated(async ({ post }, { container }) => {
  if (!post?.id) {
    return
  }
  console.log(post)
  const meta = (post.metadata || {}) as Record<string, any>
  const autoPublish = meta.auto_publish === true
  const hasMedia = Array.isArray(post.media_attachments) && (post.media_attachments as any[]).length > 0

  if (!autoPublish && !hasMedia) {
    return
  }

  try {
    const workflow = publishSocialPostWorkflow(container)
    await workflow.run({
      input: {
        post_id: post.id,
        page_id: meta.page_id as string | undefined,
      },
    })
  } catch (e: any) {
    console.error("socialPostCreated hook: publish failed", e)
  }
})
