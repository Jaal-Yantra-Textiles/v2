import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { SectionRow } from "../common/section"
import { useDate } from "../../hooks/use-date"
import { getStatusBadgeColor } from "../../lib/status-badge"
import { usePartnerConsumptionLogs } from "../../hooks/api/partner-consumption-logs"
import { usePartnerDesign } from "../../hooks/api/partner-designs"
import { usePartnerProductionRun } from "../../hooks/api/partner-production-runs"
import { DesignCostSection } from "../../routes/designs/design-detail/components/design-cost-section"
import { DesignInventoryBomSection } from "../../routes/designs/design-detail/components/design-inventory-bom-section"
import { ProductionRunCard } from "./production-run-card"

/**
 * #826 — the per-design pieces of a COLLATED design work-order, shared by the
 * three collated-order layouts (expandable / stacked / focus). Each design line
 * carries its own run + design ids on `line.metadata`; the specs + full
 * production lifecycle (runs, tasks) render INLINE in the order span so the
 * partner never leaves the order to drive a design.
 */

export type CollatedLine = Record<string, any>

/** Resolve a line's run + design (light — for headers/rows that show status). */
export const useDesignLineRun = (line: CollatedLine) => {
  const runId = line?.metadata?.production_run_id as string | undefined
  const designId = line?.metadata?.design_id as string | undefined
  const { production_run, isLoading } = usePartnerProductionRun(runId ?? "", {
    enabled: !!runId,
  })
  return { runId, designId, production_run, isLoading }
}

/** The partner-facing status of a run, from its status + lifecycle timestamps. */
export const runPartnerBadge = (
  run: any
): { label: string; color: "green" | "orange" | "red" | "blue" | "grey" } => {
  const s = String(run?.status || "")
  if (s === "completed") return { label: "Completed", color: "green" }
  if (s === "cancelled") return { label: "Cancelled", color: "red" }
  if (s === "in_progress") {
    if (run?.finished_at) return { label: "Finished", color: "orange" }
    if (run?.started_at) return { label: "In progress", color: "orange" }
    if (run?.accepted_at) return { label: "Accepted", color: "blue" }
    return { label: "In progress", color: "orange" }
  }
  if (s === "sent_to_partner") return { label: "Assigned", color: "blue" }
  return { label: s ? s.replace(/_/g, " ") : "Pending", color: "grey" }
}

/** Compact header bits (title + qty) shared by the layouts. */
export const designLineTitle = (line: CollatedLine, design?: any): string =>
  String(design?.name || line?.title || line?.metadata?.design_id || line?.id)

/**
 * The design's specs, rendered as stacked Medusa Containers (general → BOM →
 * cost), mirroring how the standalone design page and the single-design order
 * surface a design — so "the design specs live under the order form".
 */
export const DesignSpecs = ({ design }: { design: any }) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  const materials = Array.isArray(design?.inventory_items)
    ? design.inventory_items.length
    : 0
  const cost = design?.estimated_cost
  const costCurrency = design?.cost_currency

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">{t("partner.workOrders.summary")}</Heading>
          {/* Escape hatch to the full design-management surface. */}
          <Button size="small" variant="secondary" asChild>
            <Link to={`/designs/${design.id}`}>
              {t("partner.workOrders.openDesignManager")}
              <ArrowUpRightOnBox />
            </Link>
          </Button>
        </div>

        {design?.design_type && (
          <SectionRow
            title={t("partner.workOrders.type")}
            value={
              <Badge size="2xsmall" color="blue">
                {String(design.design_type)}
              </Badge>
            }
          />
        )}
        {design?.status && (
          <SectionRow
            title={t("partner.workOrders.designStatus")}
            value={
              <Badge size="2xsmall" color={getStatusBadgeColor(design.status)}>
                {String(design.status)}
              </Badge>
            }
          />
        )}
        {design?.priority && (
          <SectionRow
            title={t("partner.workOrders.priority")}
            value={
              <Badge
                size="2xsmall"
                color={
                  design.priority === "urgent"
                    ? "red"
                    : design.priority === "high"
                    ? "orange"
                    : design.priority === "medium"
                    ? "blue"
                    : "grey"
                }
              >
                {String(design.priority)}
              </Badge>
            }
          />
        )}
        {design?.target_completion_date && (
          <SectionRow
            title={t("partner.workOrders.targetDate")}
            value={getFullDate({ date: design.target_completion_date })}
          />
        )}
        {cost != null && (
          <SectionRow
            title={t("partner.workOrders.estimatedCost")}
            value={
              <Text size="small" weight="plus">
                {costCurrency
                  ? `${String(costCurrency).toUpperCase()} ${cost}`
                  : String(cost)}
              </Text>
            }
          />
        )}
        <SectionRow
          title={t("partner.workOrders.materials")}
          value={String(materials)}
        />
        {design?.description && (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
              {String(design.description)}
            </Text>
          </div>
        )}
      </Container>

      {/* Full BOM + cost breakdown — the design "specs" the operator asked to
          keep under the order form. Each self-fetches off the design id. */}
      <DesignInventoryBomSection design={design} />
      <DesignCostSection design={design} />
    </>
  )
}

/**
 * The full inline detail for ONE design of a collated order: its specs stacked
 * above its production run card (lifecycle + tasks). Fetches the run, design and
 * consumption logs off the line metadata.
 */
export const DesignLineDetail = ({
  line,
  onActionSuccess,
}: {
  line: CollatedLine
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
        <Skeleton className="mt-3 h-24 w-full" />
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <DesignSpecs design={design} />
      <ProductionRunCard
        run={production_run}
        design={design}
        consumptionLogs={logs}
        consumptionCount={count}
        onActionSuccess={onActionSuccess}
        showTimeline={false}
        taskLinkBase="tasks"
      />
    </div>
  )
}
