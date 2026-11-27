import { AdminSocialPost } from "../../hooks/api/social-posts"
import {
  useCancelInstagramReel,
  useConfirmInstagramReel,
  usePublishSocialPost,
} from "../../hooks/api/social-posts"
import { CommonField, CommonSection } from "../common/section-views"
import { useTranslation } from "react-i18next"
import dayjs from "dayjs"
import { PencilSquare, Trash, Newspaper, ArrowPath } from "@medusajs/icons"
import { useSocialPlatform } from "../../hooks/api/social-platforms"
import { useSyncPostInsights } from "../../hooks/api/post-insights"
import { toast } from "@medusajs/ui"

export const SocialPostGeneralSection = ({
  post,
}: {
  post: AdminSocialPost
}) => {
  const { t } = useTranslation()
  const { mutate: publishPost, isPending } = usePublishSocialPost()
  const { mutate: syncInsights, isPending: isSyncing } = useSyncPostInsights()
  
  // Get platform info to determine if it's FBINSTA
  const { socialPlatform } = useSocialPlatform(post.platform_id)
  const platformName = (socialPlatform?.name || "").toLowerCase()
  const isFBINSTA = platformName === "fbinsta" || platformName === "facebook & instagram"
  
  // Get publish target from metadata
  const publishTarget = (post.metadata as any)?.publish_target as "facebook" | "instagram" | "both" | undefined

  // Determine button label based on publish target
  const getPublishLabel = () => {
    if (!isFBINSTA) return t("Publish now")
    if (publishTarget === "facebook") return t("📘 Publish to Facebook")
    if (publishTarget === "instagram") return t("📷 Publish to Instagram")
    if (publishTarget === "both") return t("📘 + 📷 Publish to Both")
    return t("Publish now")
  }

  // Handler for syncing insights
  const handleSyncInsights = () => {
    syncInsights(post.id, {
      onSuccess: (data: any) => {
        const insights = data.insights || {}
        const metrics = [
          insights.likes && `${insights.likes} likes`,
          insights.comments && `${insights.comments} comments`,
          insights.impressions && `${insights.impressions} impressions`,
        ].filter(Boolean).join(", ")

        toast.success("Insights synced successfully", {
          description: metrics || "Post insights have been updated",
        })
      },
      onError: (error: any) => {
        toast.error("Failed to sync insights", {
          description: error.message || "An error occurred while syncing insights",
        })
      },
    })
  }

  // Instagram Reel in the publish-instagram-reel workflow: processing, or
  // processed and waiting for an admin to confirm it.
  const reelPending = ((post.insights || {}) as Record<string, any>).instagram_reel as
    | { transaction_id: string; stage: "processing" | "awaiting_confirmation"; started_at: string; awaiting_since?: string }
    | undefined
  const reelReady = reelPending?.stage === "awaiting_confirmation"
  const { mutate: confirmReel, isPending: isConfirming } = useConfirmInstagramReel()
  const { mutate: cancelReel, isPending: isCancelling } = useCancelInstagramReel()

  const actionGroups = [
    {
      actions: [
        {
          label: t("Edit notes"),
          icon: <Newspaper />,
          to: `notes`, // Relative path for editing
        },
      ],
    },
    {
      actions: [
        {
          label: getPublishLabel(),
          icon: <Newspaper />,
          onClick: () => {
            publishPost({ post_id: post.id })
          },
          // A Reel still processing must not be published again (refused server-side).
          disabled: post.status === "posted" || isPending || Boolean(reelPending),
        },
      ],
    },
    // Instagram Reel: confirm once processed, or cancel (nothing is posted).
    ...(reelPending
      ? [
          {
            actions: [
              ...(reelReady
                ? [
                    {
                      label: t("Confirm Reel (go live)"),
                      icon: <Newspaper />,
                      onClick: () => confirmReel(post.id),
                      disabled: isConfirming,
                    },
                  ]
                : []),
              {
                label: t("Cancel Reel"),
                icon: <Trash />,
                onClick: () => cancelReel(post.id),
                disabled: isCancelling,
              },
            ],
          },
        ]
      : []),
    // Sync Insights action (only for published posts)
    ...(post.status === "posted" ? [{
      actions: [
        {
          label: t("Sync Insights"),
          icon: <ArrowPath />,
          onClick: handleSyncInsights,
          disabled: isSyncing,
        },
      ],
    }] : []),
    {
        actions: [
          {
            label: t("actions.edit"),
            icon: <PencilSquare />,
            to: `edit`, // Relative path for editing
          },
        ],
      },
    {
      actions: [
        {
          label: t("actions.delete"),
          icon: <Trash />,
          onClick: () => {}, // Assuming CommonSection supports a danger variant for buttons
        },
      ],
    },
  ];

  // Extract platform-specific URLs from insights
  const insights = (post.insights || {}) as Record<string, any>
  const facebookPostId = insights.facebook_post_id
  const instagramPermalink = insights.instagram_permalink

  const fields: CommonField[] = [
    {
      label: t("fields.name", "Name"),
      value: post.name,
    },
    {
      label: t("fields.status", "Status"),
      value: reelReady
        ? `Instagram Reel ready (since ${dayjs(reelPending!.awaiting_since).format("HH:mm")}) — confirm to go live`
        : reelPending
          ? `Instagram is processing the Reel (since ${dayjs(reelPending.started_at).format("HH:mm")})`
          : post.status,
    },
    {
      label: t("fields.scheduled_at", "Scheduled At"),
      value: post.scheduled_at ? dayjs(post.scheduled_at).format("YYYY-MM-DD HH:mm") : "-",
    },
    {
      label: t("fields.posted_at", "Posted At"),
      value: post.posted_at ? dayjs(post.posted_at).format("YYYY-MM-DD HH:mm") : "-",
    },
  ]

  // Add platform-specific URLs for FBINSTA posts
  if (isFBINSTA && post.status === "posted") {
    if (facebookPostId) {
      const fbUrl = post.post_url || `https://www.facebook.com/${facebookPostId}`
      fields.push({
        label: "Facebook Post",
        link: {
          href: fbUrl,
          label: "View on Facebook",
        },
      })
    }
    if (instagramPermalink) {
      fields.push({
        label: "Instagram Post",
        link: {
          href: instagramPermalink,
          label: "View on Instagram",
        },
      })
    }
  } else if (post.post_url && post.status === "posted") {
    // For non-FBINSTA posts, show single post URL
    fields.push({
      label: "Post URL",
      link: {
        href: post.post_url,
        label: "View Post",
      },
    })
  }

  return (
    <CommonSection
      title={post.name}
      description={t(
        "socialPost.general.description",
        "Basic details of the social post."
      )}
      fields={fields}
      actionGroups={actionGroups}
    />
  )
}
