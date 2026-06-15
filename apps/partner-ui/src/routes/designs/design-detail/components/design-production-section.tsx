import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import { ChevronDownMini, ArrowUpRightOnBox } from "@medusajs/icons"
import { useState } from "react"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import { usePartnerProductionRuns } from "../../../../hooks/api/partner-production-runs"
import { GeneralSectionSkeleton } from "../../../../components/common/skeleton"
import { getStatusBadgeColor } from "../../../../lib/status-badge"

type DesignProductionSectionProps = {
  design: PartnerDesign
}

const TERMINAL_STATUSES = ["completed", "cancelled"]

/**
 * #342 — the design page is the authoring library; execution (tasks, cost,
 * lifecycle actions) lives on the unified order detail. This section is now a
 * compact list of the design's design orders (production runs → unified
 * `order` kind=design) that deep-links to `/orders/:id`. Runs that predate the
 * D5 link fall back to the legacy `/production-runs/:id` route, which itself
 * redirects to the unified order.
 */
export const DesignProductionSection = ({ design }: DesignProductionSectionProps) => {
  const { production_runs = [], isPending } = usePartnerProductionRuns({
    design_id: design.id,
    limit: 50,
  })
  const [showPrevious, setShowPrevious] = useState(false)

  if (isPending) {
    return <GeneralSectionSkeleton rowCount={2} />
  }

  if (!production_runs.length) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Design orders</Heading>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No design orders yet. Create a design order to start production, or
            you'll see them here once the admin sends work your way.
          </Text>
        </div>
      </Container>
    )
  }

  const activeRuns = production_runs.filter(
    (r: any) => !TERMINAL_STATUSES.includes(String(r.status))
  )
  const previousRuns = production_runs.filter(
    (r: any) => TERMINAL_STATUSES.includes(String(r.status))
  )

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Design orders</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Open a design order to accept work, log materials, and update its
          status.
        </Text>
      </div>

      {activeRuns.map((run: any) => (
        <DesignOrderRow key={String(run.id)} run={run} />
      ))}

      {previousRuns.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowPrevious((v) => !v)}
            className="flex w-full items-center justify-between px-6 py-3 hover:bg-ui-bg-base-hover transition-colors"
          >
            <Text size="small" weight="plus" className="text-ui-fg-subtle">
              Previous design orders ({previousRuns.length})
            </Text>
            <ChevronDownMini
              className={clx("text-ui-fg-muted transition-transform", {
                "rotate-180": showPrevious,
              })}
            />
          </button>
          {showPrevious &&
            previousRuns.map((run: any) => (
              <DesignOrderRow key={String(run.id)} run={run} muted />
            ))}
        </>
      )}
    </Container>
  )
}

const DesignOrderRow = ({ run, muted }: { run: any; muted?: boolean }) => {
  const status = String(run.status || "")
  const to = run.unified_order_id
    ? `/orders/${run.unified_order_id}`
    : `/production-runs/${run.id}`

  return (
    <Link
      to={to}
      className={clx(
        "flex items-center justify-between px-6 py-4 transition-colors hover:bg-ui-bg-base-hover",
        { "opacity-75": muted }
      )}
    >
      <div className="flex min-w-0 flex-col gap-y-1">
        <div className="flex items-center gap-x-2">
          <Text size="small" weight="plus" className="truncate">
            {run.run_type === "sample" ? "Sample" : "Production"} order
          </Text>
          <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
            {status.replace(/_/g, " ") || "—"}
          </Badge>
        </div>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {run.quantity != null ? `Qty ${run.quantity}` : "—"}
        </Text>
      </div>
      <div className="flex shrink-0 items-center gap-x-1 text-ui-fg-interactive">
        <Text size="small">View order</Text>
        <ArrowUpRightOnBox />
      </div>
    </Link>
  )
}
