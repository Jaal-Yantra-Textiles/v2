import { AdminSocialPost } from "../../hooks/api/social-posts"
import { PostInsightsPanel } from "./post-insights-panel"

export const SocialPostInsightsSection = ({
  post,
}: {
  post: AdminSocialPost
}) => {
  return (
    <PostInsightsPanel
      postId={post.id}
      insights={post.insights as Record<string, any>}
      status={post.status}
    />
  )
}
