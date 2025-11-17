import { CommonSection, CommonField } from "../common/section-views"

type PostInsightsPanelProps = {
  postId: string
  insights?: Record<string, any>
  status: string
}

export const PostInsightsPanel = ({ insights, status }: PostInsightsPanelProps) => {
  if (status !== "posted") {
    return (
      <CommonSection
        title="Post Insights"
        description="Insights will be available after the post is published"
        fields={[]}
      />
    )
  }

  // Extract metrics from insights
  const likes = insights?.likes || 0
  const comments = insights?.comments || 0
  const shares = insights?.shares || 0
  const impressions = insights?.impressions || 0
  const reach = insights?.reach || 0
  const engagement = insights?.engagement || 0
  const engagementRate = insights?.engagement_rate || 0
  const saves = insights?.saves || 0
  const videoViews = insights?.video_views || 0
  
  const lastSynced = insights?.last_synced_at
  const syncStatus = insights?.sync_status

  // Build fields array
  const fields: CommonField[] = []

  // Status badge
  if (syncStatus) {
    fields.push({
      label: "Sync Status",
      value: syncStatus,
      badge: {
        value: syncStatus,
        color: syncStatus === "success" ? "green" : syncStatus === "partial" ? "orange" : "red"
      }
    })
  }

  // Last synced
  if (lastSynced) {
    fields.push({
      label: "Last Synced",
      value: new Date(lastSynced).toLocaleString()
    })
  }

  // Core metrics (always show)
  fields.push({
    label: "Likes",
    value: likes.toLocaleString()
  })

  fields.push({
    label: "Comments",
    value: comments.toLocaleString()
  })

  fields.push({
    label: "Shares",
    value: shares.toLocaleString()
  })

  // Optional metrics (only if > 0)
  if (saves > 0) {
    fields.push({
      label: "Saves",
      value: saves.toLocaleString()
    })
  }

  if (impressions > 0) {
    fields.push({
      label: "Impressions",
      value: impressions.toLocaleString()
    })
  }

  if (reach > 0) {
    fields.push({
      label: "Reach",
      value: reach.toLocaleString()
    })
  }

  if (engagement > 0) {
    fields.push({
      label: "Engagement",
      value: engagement.toLocaleString()
    })
  }

  if (engagementRate > 0) {
    fields.push({
      label: "Engagement Rate",
      value: `${engagementRate.toFixed(2)}%`
    })
  }

  if (videoViews > 0) {
    fields.push({
      label: "Video Views",
      value: videoViews.toLocaleString()
    })
  }

  // Reactions breakdown (Facebook)
  if (insights?.reactions) {
    const reactions = insights.reactions
    if (reactions.like > 0) {
      fields.push({ label: "👍 Like", value: reactions.like.toString() })
    }
    if (reactions.love > 0) {
      fields.push({ label: "❤️ Love", value: reactions.love.toString() })
    }
    if (reactions.wow > 0) {
      fields.push({ label: "😮 Wow", value: reactions.wow.toString() })
    }
    if (reactions.haha > 0) {
      fields.push({ label: "😄 Haha", value: reactions.haha.toString() })
    }
    if (reactions.sad > 0) {
      fields.push({ label: "😢 Sad", value: reactions.sad.toString() })
    }
    if (reactions.angry > 0) {
      fields.push({ label: "😠 Angry", value: reactions.angry.toString() })
    }
  }

  // Sync errors
  if (insights?.sync_errors && insights.sync_errors.length > 0) {
    fields.push({
      label: "Sync Errors",
      value: insights.sync_errors.join(", ")
    })
  }

  return (
    <CommonSection
      title="Post Insights"
      description="Analytics and engagement data from social platforms"
      fields={fields}
    />
  )
}
