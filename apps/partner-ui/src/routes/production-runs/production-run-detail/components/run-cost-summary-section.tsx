import { Container, Heading, Text } from "@medusajs/ui"

import { SectionRow } from "../../../../components/common/section"
import { usePartnerRunCostSummary } from "../../../../hooks/api/partner-production-runs"

type Props = { runId: string }

const fmt = (v?: number | null) =>
  v == null
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })

/**
 * Roadmap #6 Phase 5 — production-run cost summary (admin parity):
 * material + energy + labor + partner estimate → grand total +
 * cost-per-unit, sourced from the run's consumption logs.
 */
export const RunCostSummarySection = ({ runId }: Props) => {
  const { cost_summary, isLoading, isError } = usePartnerRunCostSummary(runId)

  if (isError) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Cost summary</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Material, energy, labor + your estimate for this run.
        </Text>
      </div>

      {isLoading ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        </div>
      ) : !cost_summary ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No cost data yet.
          </Text>
        </div>
      ) : (
        <>
          <SectionRow title="Material" value={fmt(cost_summary.material?.total)} />
          <SectionRow title="Energy" value={fmt(cost_summary.energy?.total)} />
          <SectionRow
            title="Labor"
            value={
              cost_summary.labor
                ? `${fmt(cost_summary.labor.total)}${
                    cost_summary.labor.total_hours
                      ? `  (${fmt(cost_summary.labor.total_hours)} h)`
                      : ""
                  }`
                : "—"
            }
          />
          <SectionRow
            title="Your estimate"
            value={fmt(cost_summary.partner?.total)}
          />
          <SectionRow
            title="Grand total"
            value={
              <Text size="small" weight="plus">
                {fmt(cost_summary.grand_total)}
              </Text>
            }
          />
          <SectionRow
            title="Cost / unit"
            value={fmt(cost_summary.cost_per_unit)}
          />
          <SectionRow
            title="Consumption logs"
            value={String(cost_summary.total_consumption_logs ?? 0)}
          />
        </>
      )}
    </Container>
  )
}
