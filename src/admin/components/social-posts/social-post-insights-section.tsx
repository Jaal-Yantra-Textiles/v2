import { AdminSocialPost } from "../../hooks/api/social-posts"
import { CommonSection, CommonField } from "../common/section-views"
import { useTranslation } from "react-i18next"
import dayjs from "dayjs"

export const SocialPostInsightsSection = ({
  post,
}: {
  post: AdminSocialPost
}) => {
  const { t } = useTranslation()

  const insights = (post.insights || {}) as Record<string, any>

  // Extract Facebook insights
  const facebookInsights = insights.facebook_insights as Record<string, any> | undefined
  const facebookPostId = insights.facebook_post_id as string | undefined

  // Extract Instagram insights
  const instagramInsights = insights.instagram_insights as Record<string, any> | undefined
  const instagramMediaId = insights.instagram_media_id as string | undefined
  const instagramPermalink = insights.instagram_permalink as string | undefined

  // Extract Twitter insights
  const twitterTweetId = insights.twitter_tweet_id as string | undefined

  // Extract webhook data
  const comments = insights.comments as any[] | undefined
  const reactions = insights.reactions as Record<string, number> | undefined

  const fields: CommonField[] = []

  // Facebook Insights
  if (facebookPostId) {
    fields.push({
      label: t("insights.facebook_post_id", "Facebook Post ID"),
      value: facebookPostId,
    })
  }

  if (facebookInsights) {
    if (facebookInsights.impressions !== undefined) {
      fields.push({
        label: t("insights.facebook_impressions", "FB Impressions"),
        value: facebookInsights.impressions.toString(),
      })
    }
    if (facebookInsights.reach !== undefined) {
      fields.push({
        label: t("insights.facebook_reach", "FB Reach"),
        value: facebookInsights.reach.toString(),
      })
    }
    if (facebookInsights.engagement !== undefined) {
      fields.push({
        label: t("insights.facebook_engagement", "FB Engagement"),
        value: facebookInsights.engagement.toString(),
      })
    }
    if (facebookInsights.last_updated) {
      fields.push({
        label: t("insights.facebook_last_updated", "FB Last Updated"),
        value: dayjs(facebookInsights.last_updated).format("YYYY-MM-DD HH:mm"),
      })
    }
  }

  // Instagram Insights
  if (instagramMediaId) {
    fields.push({
      label: t("insights.instagram_media_id", "Instagram Media ID"),
      value: instagramMediaId,
    })
  }

  if (instagramPermalink) {
    fields.push({
      label: t("insights.instagram_permalink", "Instagram Link"),
      link: {
        href: instagramPermalink,
        label: "View on Instagram",
      },
    })
  }

  if (instagramInsights) {
    if (instagramInsights.impressions !== undefined) {
      fields.push({
        label: t("insights.instagram_impressions", "IG Impressions"),
        value: instagramInsights.impressions.toString(),
      })
    }
    if (instagramInsights.reach !== undefined) {
      fields.push({
        label: t("insights.instagram_reach", "IG Reach"),
        value: instagramInsights.reach.toString(),
      })
    }
    if (instagramInsights.engagement !== undefined) {
      fields.push({
        label: t("insights.instagram_engagement", "IG Engagement"),
        value: instagramInsights.engagement.toString(),
      })
    }
    if (instagramInsights.likes !== undefined) {
      fields.push({
        label: t("insights.instagram_likes", "IG Likes"),
        value: instagramInsights.likes.toString(),
      })
    }
    if (instagramInsights.comments !== undefined) {
      fields.push({
        label: t("insights.instagram_comments", "IG Comments"),
        value: instagramInsights.comments.toString(),
      })
    }
    if (instagramInsights.saves !== undefined) {
      fields.push({
        label: t("insights.instagram_saves", "IG Saves"),
        value: instagramInsights.saves.toString(),
      })
    }
    if (instagramInsights.last_updated) {
      fields.push({
        label: t("insights.instagram_last_updated", "IG Last Updated"),
        value: dayjs(instagramInsights.last_updated).format("YYYY-MM-DD HH:mm"),
      })
    }
  }

  // Twitter Insights
  if (twitterTweetId) {
    fields.push({
      label: t("insights.twitter_tweet_id", "Twitter Tweet ID"),
      value: twitterTweetId,
    })
  }

  // Comments count
  if (comments && Array.isArray(comments)) {
    fields.push({
      label: t("insights.comments_count", "Comments"),
      value: comments.length.toString(),
    })
  }

  // Reactions
  if (reactions && typeof reactions === "object") {
    const totalReactions = Object.values(reactions).reduce((sum, count) => sum + (count || 0), 0)
    fields.push({
      label: t("insights.reactions_total", "Total Reactions"),
      value: totalReactions.toString(),
    })

    // Show individual reaction types
    Object.entries(reactions).forEach(([type, count]) => {
      if (count && count > 0) {
        fields.push({
          label: t(`insights.reaction_${type}`, type),
          value: count.toString(),
        })
      }
    })
  }

  // If no insights data available
  if (fields.length === 0) {
    fields.push({
      label: t("insights.no_data", "Status"),
      value: post.status === "posted" 
        ? t("insights.pending", "Insights pending from webhooks")
        : t("insights.not_posted", "Post not yet published"),
    })
  }

  return (
    <CommonSection
      title={t("insights.title", "Insights")}
      description={t(
        "insights.description",
        "Analytics and engagement data from social platforms."
      )}
      fields={fields}
    />
  )
}
