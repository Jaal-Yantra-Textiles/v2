import { Button, toast } from "@medusajs/ui"
import { ArrowPath } from "@medusajs/icons"
import { type AdsPlatformKind, useAdsSync } from "../../../hooks/api/ads"

type Props = {
  platformId: string
  kind: AdsPlatformKind | null
}

/**
 * Single "Sync now" button. Google triggers the unified sync workflow
 * (campaigns + ad_groups + ads + insights); Meta returns the legacy-routes
 * hint and we render a friendly toast pointing the operator at the right
 * page rather than silently no-op'ing.
 */
export const SyncButton = ({ platformId, kind }: Props) => {
  const sync = useAdsSync()

  const onSync = async () => {
    try {
      const res = await sync.mutateAsync({
        platform_id: platformId,
        include_ads: true,
        include_insights: true,
      })
      if (res.platform === "meta") {
        toast.info("Meta sync runs through Meta Ads page", {
          description:
            res.hint ||
            "Open /admin/meta-ads and trigger Accounts / Campaigns / Insights sync there.",
        })
        return
      }
      const r = res.result
      if (!r) {
        toast.success("Sync started")
        return
      }
      const parts = [
        `${r.customers_synced ?? 0} accounts`,
        `${r.campaigns_synced ?? 0} campaigns`,
        `${r.ad_groups_synced ?? 0} ad groups`,
        `${r.ads_synced ?? 0} ads`,
        `${r.insights_rows_synced ?? 0} insights rows`,
      ].join(" · ")
      if (r.errors && r.errors.length) {
        toast.warning(`Synced with ${r.errors.length} error(s)`, {
          description: parts + " — " + r.errors[0].message,
        })
      } else {
        toast.success("Sync complete", { description: parts })
      }
    } catch (e: any) {
      toast.error("Sync failed", { description: e?.message || String(e) })
    }
  }

  return (
    <Button
      size="small"
      variant="secondary"
      onClick={onSync}
      isLoading={sync.isPending}
      disabled={!platformId || sync.isPending}
    >
      {!sync.isPending && <ArrowPath className="mr-1" />}
      Sync now
    </Button>
  )
}
