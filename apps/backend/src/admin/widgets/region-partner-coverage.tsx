import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  Checkbox,
  Label,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import {
  useRegionPartnerCoverage,
  useShareRegionToAllPartners,
} from "../hooks/api/region-coverage"

type Region = { id: string; name?: string; currency_code?: string }

const RegionPartnerCoverageWidget = ({ data }: DetailWidgetProps<Region>) => {
  const regionId = data.id
  const { data: coverage, isLoading } = useRegionPartnerCoverage(regionId)
  const share = useShareRegionToAllPartners(regionId)
  const [triggerFanout, setTriggerFanout] = useState(false)

  const handleShare = async () => {
    try {
      const out = await share.mutateAsync({ trigger_fanout: triggerFanout })
      const r = out.result
      const fanoutLine = triggerFanout
        ? ` · ${r.fanout_invocations} fanout invocations, ${r.fanout_created_prices} prices created`
        : ""
      toast.success(
        `Shared region to partners — ${r.links_created} new link(s), ${r.stores_currency_updated} store(s) currency updated${fanoutLine}`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      toast.error(`Share to all failed: ${message}`)
    }
  }

  const unlinkedCount = coverage?.unlinked_partners?.length ?? 0
  const allLinked = !!coverage && unlinkedCount === 0

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Partner coverage</Heading>
        {coverage && (
          <Badge size="2xsmall" color={allLinked ? "green" : "orange"}>
            {coverage.linked_partners} / {coverage.total_partners} linked
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-y-3 px-6 py-4 text-sm">
        {isLoading && <Text className="text-ui-fg-subtle">Loading…</Text>}

        {coverage && allLinked && (
          <Text className="text-ui-fg-subtle">
            Every partner is already linked to this region. New partners
            are auto-linked on creation.
          </Text>
        )}

        {coverage && !allLinked && (
          <>
            <Text className="text-ui-fg-subtle">
              {unlinkedCount} partner{unlinkedCount === 1 ? "" : "s"} not yet
              linked to <strong>{coverage.region.name}</strong>{" "}
              ({coverage.region.currency_code}). Sharing will create the
              missing <code>partner_region</code> links and extend each
              store&apos;s <code>supported_currencies</code>.
            </Text>

            <div className="flex flex-col gap-y-2 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
              <Label className="flex items-center gap-x-2 text-xs">
                <Checkbox
                  checked={triggerFanout}
                  onCheckedChange={(checked) => setTriggerFanout(!!checked)}
                />
                <span>
                  Also fan out FX prices on existing variants (slower; ~1
                  workflow invocation per variant price)
                </span>
              </Label>

              <Button
                size="small"
                variant="secondary"
                onClick={handleShare}
                isLoading={share.isPending}
                disabled={share.isPending}
              >
                Share to {unlinkedCount} partner
                {unlinkedCount === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Container>
  )
}

// The region detail page is single-column — the core dashboard only renders
// `region.details.before` / `region.details.after` (there is no `.side.*` zone
// for regions, unlike products). `region.details.side.after` silently never
// mounted; `.after` places this supplementary panel below the region details. (#421)
export const config = defineWidgetConfig({
  zone: "region.details.after",
})

export default RegionPartnerCoverageWidget
