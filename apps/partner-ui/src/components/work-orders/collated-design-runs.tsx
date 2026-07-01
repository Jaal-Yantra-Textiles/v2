import { Container, Skeleton, Text } from "@medusajs/ui"

import { usePartnerConsumptionLogs } from "../../hooks/api/partner-consumption-logs"
import { usePartnerDesign } from "../../hooks/api/partner-designs"
import { usePartnerProductionRun } from "../../hooks/api/partner-production-runs"
import { ProductionRunCard } from "./production-run-card"

/**
 * #826 — the production lifecycle for a COLLATED design work-order, one full
 * <ProductionRunCard> per design line, so a partner drives accept → start →
 * finish → complete (plus material logging + tasks) for EVERY design of the
 * order from the single order screen. Each line carries its own run + design ids
 * (metadata.production_run_id / design_id); the card is the same one the design
 * page renders N-up, reused here for the order context.
 */

const DesignRunLifecycleCard = ({
  line,
  onActionSuccess,
}: {
  line: Record<string, any>
  onActionSuccess?: () => void
}) => {
  const runId = line?.metadata?.production_run_id as string | undefined
  const designId = line?.metadata?.design_id as string | undefined

  const { production_run } = usePartnerProductionRun(runId ?? "", {
    enabled: !!runId,
  })
  const { design } = usePartnerDesign(designId ?? "", { enabled: !!designId })
  const { logs = [], count = 0 } = usePartnerConsumptionLogs(
    designId ?? "",
    undefined,
    { enabled: !!designId }
  )

  if (!runId || !designId) {
    return null
  }

  if (!production_run || !design) {
    return (
      <Container className="p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-3 h-16 w-full" />
      </Container>
    )
  }

  return (
    <ProductionRunCard
      run={production_run}
      design={design}
      consumptionLogs={logs}
      consumptionCount={count}
      onActionSuccess={onActionSuccess}
      showTimeline={false}
      taskLinkBase="tasks"
    />
  )
}

export const CollatedDesignRuns = ({
  lines,
  onActionSuccess,
}: {
  lines: Array<Record<string, any>>
  onActionSuccess?: () => void
}) => {
  const runLines = (lines ?? []).filter(
    (l) => l?.metadata?.production_run_id && l?.metadata?.design_id
  )

  if (!runLines.length) {
    return null
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-2 px-1">
        <Text size="small" weight="plus" className="text-ui-fg-subtle">
          Production ({runLines.length})
        </Text>
      </div>
      {runLines.map((line) => (
        <DesignRunLifecycleCard
          key={String(line.id)}
          line={line}
          onActionSuccess={onActionSuccess}
        />
      ))}
    </div>
  )
}
