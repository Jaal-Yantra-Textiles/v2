import { Heading, Text } from "@medusajs/ui"

interface SocialPostPreviewProps {
  platformName: string
  postName: string
  message: string
  mediaUrls: string[]
  postType?: string
  userProfile?: {
    name?: string
    username?: string
    profile_image_url?: string
    verified?: boolean
  }
}

export const SocialPostPreview = ({
  platformName,
  postName,
  message,
  mediaUrls,
  postType,
  userProfile,
}: SocialPostPreviewProps) => {
  const platform = platformName.toLowerCase()
  const hasMedia = mediaUrls && mediaUrls.length > 0
  const isTwitter = platform === "twitter" || platform === "x"

  return (
    <div className="p-6">
      <div className="mb-6">
        <Heading level="h3">Preview</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          {postName}
        </Text>
      </div>

      {/* Mock Social Media Post Card */}
      <div className="bg-ui-bg-base rounded-lg border border-ui-border-base overflow-hidden">
        {/* Header */}
        <div className="p-4 flex items-center gap-3 border-b border-ui-border-base">
          {userProfile?.profile_image_url ? (
            <img 
              src={userProfile.profile_image_url} 
              alt={userProfile.name || platformName}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-ui-bg-subtle flex items-center justify-center text-ui-fg-base font-bold">
              {isTwitter ? "𝕏" : platformName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <div className="font-semibold text-sm flex items-center gap-1 text-ui-fg-base">
              {userProfile?.name || platformName}
              {isTwitter && userProfile?.verified && <span className="text-ui-fg-muted">✓</span>}
            </div>
            <div className="text-xs text-ui-fg-subtle">
              {isTwitter && userProfile?.username ? `@${userProfile.username} · Just now` : "Just now"}
            </div>
          </div>
        </div>

        {/* Caption/Message */}
        {message && (
          <div className="p-4">
            <Text size="small" className="whitespace-pre-wrap">
              {message}
            </Text>
          </div>
        )}

        {/* Media */}
        {hasMedia && (
          <div className="relative">
            {mediaUrls.length === 1 ? (
              // Single image
              <div className={`w-full ${isTwitter ? "max-h-[400px]" : "aspect-square"} bg-ui-bg-subtle`}>
                <img
                  src={mediaUrls[0]}
                  alt="Post media"
                  className={`w-full h-full ${isTwitter ? "object-contain" : "object-cover"} ${isTwitter ? "rounded-2xl" : ""}`}
                />
              </div>
            ) : (
              // Multiple images - show grid
              <div className={`grid ${isTwitter ? "gap-1 rounded-2xl overflow-hidden" : "gap-0.5"} ${
                mediaUrls.length === 2 ? "grid-cols-2" :
                mediaUrls.length === 3 ? "grid-cols-3" :
                mediaUrls.length === 4 ? "grid-cols-2 grid-rows-2" :
                "grid-cols-3"
              }`}>
                {mediaUrls.slice(0, isTwitter ? 4 : 6).map((url, index) => (
                  <div
                    key={index}
                    className={`relative ${isTwitter ? "aspect-video" : "aspect-square"} bg-ui-bg-subtle overflow-hidden`}
                  >
                    <img
                      src={url}
                      alt={`Media ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {!isTwitter && index === 5 && mediaUrls.length > 6 && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <Text className="text-white font-bold text-2xl">
                          +{mediaUrls.length - 6}
                        </Text>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Placeholder when no media */}
        {!hasMedia && postType === "photo" && (
          <div className="w-full aspect-square bg-ui-bg-subtle flex items-center justify-center border-t">
            <div className="text-center p-8">
              <div className="text-4xl mb-2">📷</div>
              <Text size="small" className="text-ui-fg-subtle">
                No media selected
              </Text>
            </div>
          </div>
        )}

        {/* Engagement Bar */}
        <div className={`p-4 border-t border-ui-border-base flex items-center ${isTwitter ? "justify-around" : "justify-between"} text-ui-fg-subtle`}>
          <div className={`flex items-center ${isTwitter ? "gap-8" : "gap-4"}`}>
            {isTwitter ? (
              <>
                <button className="hover:text-ui-fg-base transition-colors flex items-center gap-1">
                  <span>💬</span>
                  <span className="text-xs">Reply</span>
                </button>
                <button className="hover:text-ui-fg-base transition-colors flex items-center gap-1">
                  <span>🔄</span>
                  <span className="text-xs">Repost</span>
                </button>
                <button className="hover:text-ui-fg-base transition-colors flex items-center gap-1">
                  <span>❤️</span>
                  <span className="text-xs">Like</span>
                </button>
                <button className="hover:text-ui-fg-base transition-colors flex items-center gap-1">
                  <span>📊</span>
                  <span className="text-xs">View</span>
                </button>
                <button className="hover:text-ui-fg-base transition-colors flex items-center gap-1">
                  <span>📤</span>
                  <span className="text-xs">Share</span>
                </button>
              </>
            ) : (
              <>
                <button className="hover:text-ui-fg-base transition-colors">
                  ❤️ Like
                </button>
                <button className="hover:text-ui-fg-base transition-colors">
                  💬 Comment
                </button>
                <button className="hover:text-ui-fg-base transition-colors">
                  🔄 Share
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Platform-specific notes */}
      <div className="mt-4 p-3 rounded-md bg-ui-bg-subtle border border-ui-border-base">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {platform === "facebook" && "📘 This is how your post will appear on Facebook"}
          {platform === "instagram" && "📷 This is how your post will appear on Instagram"}
          {(platform === "fbinsta" || platform === "facebook & instagram") && 
            "📘📷 This preview shows how your post will appear on social media"}
          {isTwitter && (
            <div>
              <div className="font-semibold mb-1">🐦 Twitter/X Preview</div>
              <div className="text-xs">This is how your tweet will appear on the timeline</div>
            </div>
          )}
        </Text>
      </div>
    </div>
  )
}
