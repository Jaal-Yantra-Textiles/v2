import { createSocialPostWorkflow } from "../socials/create-social-post"
import { publishSocialPostUnifiedWorkflow } from "../socials/publish-social-post-unified"

/**
 * When a SocialPost is created: publish it ONLY if it asked to be, with
 * `metadata.auto_publish: true`.
 *
 * 🔴 This used to publish any post that merely had media attached
 * (`if (!autoPublish && !hasMedia) return`), so a draft with a photo went
 * live the moment it was saved — contradicting the admin form's "Auto
 * publish" toggle and the MCP tool's "draft by default". It also went
 * through the legacy workflow, which bypasses the Instagram Reel flow.
 * Now it runs the same unified workflow as the Publish button.
 */
createSocialPostWorkflow.hooks.socialPostCreated(async ({ post }, { container }) => {
  if (!post?.id) {
    return
  }
  const meta = (post.metadata || {}) as Record<string, any>
  if (meta.auto_publish !== true) {
    return
  }

  try {
    await publishSocialPostUnifiedWorkflow(container).run({
      input: {
        post_id: post.id,
        override_page_id: meta.page_id as string | undefined,
      },
    })
  } catch (e: any) {
    console.error("socialPostCreated hook: auto-publish failed", e?.message || e)
  }
})
