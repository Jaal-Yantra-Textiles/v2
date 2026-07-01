import {
  Badge,
  Container,
  Heading,
  StatusBadge,
  Text,
  clx,
} from "@medusajs/ui"
import { ArrowRightMini, ArrowUpRightOnBox, PencilSquare } from "@medusajs/icons"
import { Link } from "react-router-dom"

import { ActionMenu } from "../../components/common/action-menu"
import { useProductionRuns } from "../../hooks/api/production-runs"
import { usePartners } from "../../hooks/api/partners"

// ── Lifecycle helpers ────────────────────────────────────────────────

const STEPS = ["Received", "Accepted", "Started", "Finished", "Completed"]

const stepIndex = (run: any): number => {
  const s = String(run?.status || "")
  if (run?.completed_at || s === "completed") return 4
  if (run?.finished_at) return 3
  if (run?.started_at || s === "in_progress") return 2
  if (run?.accepted_at) return 1
  return 0
}

const runStatusColor = (
  status: string
): "green" | "orange" | "red" | "blue" | "grey" => {
  switch (status) {
    case "completed":
      return "green"
    case "in_progress":
      return "orange"
    case "sent_to_partner":
      return "blue"
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
}

/** What's happening right now, admin-facing. */
const adminStatusHint = (run: any): string => {
  const s = String(run?.status || "")
  if (s === "completed") return "Completed"
  if (s === "cancelled") return "Cancelled"
  if (s === "in_progress") {
    if (run.finished_at) return "Finished — awaiting completion"
    if (run.started_at) return "Partner is producing"
    if (run.accepted_at) return "Accepted — not started"
    return "In progress"
  }
  if (s === "sent_to_partner") return "Sent — awaiting acceptance"
  return "Not sent to a partner yet"
}

/** The partner's NEXT step in the lifecycle ("up ahead"), or null when none. */
const partnerNextStep = (run: any): string | null => {
  const s = String(run?.status || "")
  if (s === "sent_to_partner") return "Accept the run"
  if (s === "in_progress") {
    if (run.finished_at) return "Complete with output + cost"
    if (run.started_at) return "Mark finished"
    if (run.accepted_at) return "Start working"
    return "Start working"
  }
  return null
}

const fmtDate = (date?: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null

const fmtCost = (cost?: number | null, currency?: string | null) => {
  if (cost == null) return null
  const cur = (currency || "").toUpperCase()
  return cur ? `${cur} ${cost}` : String(cost)
}

// ── Compact progress stepper ─────────────────────────────────────────

const MiniStepper = ({ run }: { run: any }) => {
  if (String(run?.status) === "cancelled") return null
  const idx = stepIndex(run)
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((label, i) => {
        const done = i <= idx
        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={clx("h-1.5 w-full rounded-full", {
                "bg-ui-fg-interactive": done,
                "bg-ui-border-base": !done,
              })}
            />
            <Text
              size="xsmall"
              className={clx({
                "text-ui-fg-base font-medium": i === idx,
                "text-ui-fg-subtle": done && i !== idx,
                "text-ui-fg-muted": !done,
              })}
            >
              {label}
            </Text>
          </div>
        )
      })}
    </div>
  )
}

// ── Per-design run card ──────────────────────────────────────────────

export const RunCard = ({
  run,
  design,
  partnerName,
  currencyCode,
}: {
  run: any
  design?: any
  partnerName?: string | null
  currencyCode?: string
}) => {
  const status = String(run.status || "")
  const title = design?.name || run?.snapshot?.design?.name || `Design ${run.design_id}`
  const nextStep = partnerNextStep(run)
  const targetDate = fmtDate(design?.target_completion_date)
  const cost = fmtCost(
    run?.partner_cost_estimate ?? design?.estimated_cost,
    (design as any)?.cost_currency ?? currencyCode
  )

  return (
    <div
      className={clx("flex flex-col gap-y-3 px-6 py-4", {
        "opacity-60": status === "cancelled",
      })}
    >
      {/* Title row: design + key badges + actions */}
      <div className="flex items-start justify-between gap-x-3">
        <div className="flex min-w-0 flex-col gap-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {design?.id ? (
              <Link
                to={`/designs/${design.id}`}
                className="text-ui-fg-base hover:text-ui-fg-interactive"
              >
                <Text size="small" weight="plus" className="truncate">
                  {title}
                </Text>
              </Link>
            ) : (
              <Text size="small" weight="plus" className="truncate">
                {title}
              </Text>
            )}
            {design?.design_type && (
              <Badge size="2xsmall" color="grey">
                {String(design.design_type)}
              </Badge>
            )}
            <StatusBadge color={runStatusColor(status)}>
              {status.replace(/_/g, " ")}
            </StatusBadge>
          </div>
          {/* Important design details */}
          <Text size="xsmall" className="text-ui-fg-subtle">
            Qty {run.quantity ?? "—"}
            {cost ? ` · ${cost}` : ""}
            {targetDate ? ` · due ${targetDate}` : ""}
            {` · ${partnerName ? partnerName : "Unassigned"}`}
          </Text>
        </div>
        {/* Lifecycle actions (approve / dispatch / cost / cancel / tasks) live on
            the canonical run page — link there instead of duplicating them. */}
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Manage run",
                  icon: <ArrowUpRightOnBox />,
                  to: `/production-runs/${run.id}`,
                },
                ...(design?.id
                  ? [
                      {
                        label: "View design",
                        icon: <PencilSquare />,
                        to: `/designs/${design.id}`,
                      },
                    ]
                  : []),
              ],
            },
          ]}
        />
      </div>

      <MiniStepper run={run} />

      {/* Now + what the partner will do next ("up ahead") */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Text size="xsmall" className="text-ui-fg-subtle">
          Now: <span className="text-ui-fg-base">{adminStatusHint(run)}</span>
        </Text>
        {nextStep && (
          <div className="flex items-center gap-x-1">
            <ArrowRightMini className="text-ui-fg-muted" />
            <Text size="xsmall" className="text-ui-fg-subtle">
              Partner's next:{" "}
              <span className="text-ui-fg-base">{nextStep}</span>
            </Text>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reusable run list ────────────────────────────────────────────────

/**
 * The per-design run cards, joined to design details + partner names. Reused by
 * the commissioning design-order Production section AND the standalone
 * design-work-orders admin view (no-customer produced orders).
 */
export const ProductionRunList = ({
  runs,
  designById = {},
  partnerNameById = {},
  currencyCode,
}: {
  runs: any[]
  designById?: Record<string, any>
  partnerNameById?: Record<string, string>
  currencyCode?: string
}) => (
  <>
    {runs.map((run: any) => (
      <RunCard
        key={String(run.id)}
        run={run}
        design={designById[run.design_id]}
        partnerName={run.partner_id ? partnerNameById[run.partner_id] : null}
        currencyCode={currencyCode}
      />
    ))}
  </>
)

// ── Section ──────────────────────────────────────────────────────────

/**
 * #826 — the admin mirror of the collated production lifecycle. Once a design
 * order is produced, this lists every per-design run (fanned out from the ONE
 * commissioning order) with its status, a progress stepper, the important design
 * details, and — surfaced for the operator — what the PARTNER will do next.
 */
export const DesignOrderProductionSection = ({
  designOrder,
}: {
  designOrder: any
}) => {
  const orderId = designOrder?.order?.id as string | undefined
  const currencyCode = designOrder?.order?.currency_code || "inr"

  const { production_runs = [], isLoading } = useProductionRuns(
    { order_id: orderId, limit: 100 },
    { enabled: !!orderId } as any
  )

  const hasRuns = production_runs.length > 0

  // Design details map (this line + its siblings) to enrich each run.
  const designById: Record<string, any> = {}
  if (designOrder?.design?.id) designById[designOrder.design.id] = designOrder.design
  for (const s of designOrder?.sibling_items ?? []) {
    if (s?.design?.id) designById[s.design.id] = s.design
  }

  const partnerIds = Array.from(
    new Set(production_runs.map((r: any) => r.partner_id).filter(Boolean))
  )
  const { partners = [] } = usePartners(
    { limit: 200 },
    { enabled: hasRuns && partnerIds.length > 0 } as any
  )
  const partnerNameById: Record<string, string> = {}
  for (const p of partners as any[]) partnerNameById[p.id] = p.name

  // Nothing produced yet → the Produce action lives in the Order section.
  if (!orderId || (!isLoading && !hasRuns)) return null

  // Sort: sample runs first is not meaningful here; keep created order.
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Production</Heading>
          {hasRuns && (
            <Badge size="2xsmall" color="grey">
              {production_runs.length}
            </Badge>
          )}
        </div>
      </div>

      {isLoading && !hasRuns ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Loading production…
          </Text>
        </div>
      ) : (
        production_runs.map((run: any) => (
          <RunCard
            key={String(run.id)}
            run={run}
            design={designById[run.design_id]}
            partnerName={run.partner_id ? partnerNameById[run.partner_id] : null}
            currencyCode={currencyCode}
          />
        ))
      )}
    </Container>
  )
}
