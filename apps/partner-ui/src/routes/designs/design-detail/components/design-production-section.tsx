import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import { ChevronDownMini } from "@medusajs/icons"
import { useState } from "react"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import { usePartnerProductionRuns } from "../../../../hooks/api/partner-production-runs"
import { usePartnerConsumptionLogs } from "../../../../hooks/api/partner-consumption-logs"
import { ProductionRunCard } from "../../../../components/work-orders/production-run-card"

type DesignProductionSectionProps = {
  design: PartnerDesign
}

const TERMINAL_STATUSES = ["completed", "cancelled"]

export const DesignProductionSection = ({ design }: DesignProductionSectionProps) => {
  const { production_runs = [], isPending } = usePartnerProductionRuns({
    design_id: design.id,
    limit: 50,
  })
  const [showPrevious, setShowPrevious] = useState(false)

  // Fetch consumption logs once at section level, pass count down to cards
  const { logs: allConsumptionLogs = [], count: totalConsumptionCount = 0 } =
    usePartnerConsumptionLogs(design.id)

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Production</Heading>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
        </div>
      </Container>
    )
  }

  if (!production_runs.length) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Production</Heading>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No production runs assigned yet. You'll see them here once the admin sends work your way.
          </Text>
        </div>
      </Container>
    )
  }

  // Split into active (current) and previous (completed/cancelled) runs
  const activeRuns = production_runs.filter(
    (r: any) => !TERMINAL_STATUSES.includes(String(r.status))
  )
  const previousRuns = production_runs.filter(
    (r: any) => TERMINAL_STATUSES.includes(String(r.status))
  )

  return (
    <>
      {/* Active runs — always shown prominently */}
      {activeRuns.map((run: any) => (
        <ProductionRunCard key={String(run.id)} run={run} design={design} consumptionLogs={allConsumptionLogs} consumptionCount={totalConsumptionCount} />
      ))}

      {/* Previous runs — collapsed behind a disclosure */}
      {previousRuns.length > 0 && (
        <Container className="divide-y p-0">
          <button
            type="button"
            onClick={() => setShowPrevious((v) => !v)}
            className="flex w-full items-center justify-between px-6 py-3 hover:bg-ui-bg-base-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <Text size="small" weight="plus" className="text-ui-fg-subtle">
                Previous Runs ({previousRuns.length})
              </Text>
              {previousRuns.map((r: any) => (
                <Badge key={String(r.id)} size="2xsmall" color={String(r.status) === "completed" ? "green" : "red"}>
                  {r.run_type === "sample" ? "Sample" : "Production"} — {String(r.status).replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
            <ChevronDownMini
              className={clx("text-ui-fg-muted transition-transform", {
                "rotate-180": showPrevious,
              })}
            />
          </button>
          {showPrevious && (
            <div className="flex flex-col gap-y-4 py-4">
              {previousRuns.map((run: any) => (
                <div key={String(run.id)} className="opacity-75">
                  <ProductionRunCard run={run} design={design} consumptionLogs={allConsumptionLogs} consumptionCount={totalConsumptionCount} />
                </div>
              ))}
            </div>
          )}
        </Container>
      )}
    </>
  )
}
