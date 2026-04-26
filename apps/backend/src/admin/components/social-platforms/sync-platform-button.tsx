import { Button, toast } from "@medusajs/ui"
import { useSyncPlatformData } from "../../hooks/api/hashtags"

type SyncPlatformButtonProps = {
  platformId: string
  platformName?: string
}

export const SyncPlatformButton = ({ platformId, platformName }: SyncPlatformButtonProps) => {
  const { mutate: syncData, isPending } = useSyncPlatformData()

  const handleSync = () => {
    syncData(platformId, {
      onSuccess: (data: any) => {
        const results = data.results || {}
        const messages = [
          results.instagram_hashtags?.message,
          results.instagram_mentions?.message,
          results.facebook_hashtags?.message,
        ].filter(Boolean)

        toast.success("Sync completed!", {
          description: messages.join(", "),
        })
      },
      onError: (error: any) => {
        toast.error("Sync failed", {
          description: error.message || "Failed to sync platform data",
        })
      },
    })
  }

  return (
    <Button
      onClick={handleSync}
      isLoading={isPending}
      variant="secondary"
      size="small"
    >
      🔄 Sync Hashtags & Mentions
      {platformName && ` from ${platformName}`}
    </Button>
  )
}
