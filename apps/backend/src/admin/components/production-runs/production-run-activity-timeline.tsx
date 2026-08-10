import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { useState } from "react"

import {
  AdminProductionRunActivity,
  useProductionRunActivities,
} from "../../hooks/api/production-runs"

/**
 * The run's activity stream (#1093 / #1228 / #1239).
 *
 * `GET /admin/production-runs/:id/activities` has been populated for a while —
 * lifecycle transitions, reminder dispatches, reassignment escalations, admin
 * output corrections, and goods transfers — but nothing rendered it, so an
 * admin correcting a partner's reported output had no way to see that the
 * correction had been recorded at all. This is that view.
 *
 * Ordered newest first, which is how the API returns it.
 */

const PAGE_SIZE = 20

/** Dot colour by activity type — the coarsest signal, readable at a glance. */
const DOT_CLASS: Record<string, string> = {
  lifecycle_event: "bg-ui-tag-blue-icon",
  reminder_sent: "bg-ui-tag-orange-icon",
  note: "bg-ui-tag-purple-icon",
  system: "bg-ui-fg-muted",
}

/** Kinds that deserve to stand out from ordinary lifecycle progress. */
const NOTABLE_KINDS = new Set([
  "output_corrected",
  "cancelled",
  "reassignment_needed",
  "reminder_escalated",
  "reminder_retried_same_partner",
])

const formatWhen = (value?: string | null) => {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const formatKind = (kind?: string | null) =>
  String(kind || "").replace(/_/g, " ") || "-"

/**
 * The few payload fields worth surfacing inline. Everything else stays in the
 * payload — this is a timeline, not a debugger.
 */
const detailLines = (activity: AdminProductionRunActivity): string[] => {
  const payload = activity.payload || {}
  const lines: string[] = []

  if (payload.reason) {
    lines.push(`Reason: ${payload.reason}`)
  }
  if (payload.notes) {
    lines.push(String(payload.notes))
  }
  if (payload.rejection_reason) {
    lines.push(`Rejected: ${payload.rejection_reason}`)
  }
  if (payload.cancelled_reason) {
    lines.push(`Cancelled: ${payload.cancelled_reason}`)
  }
  if (activity.kind === "output_corrected" && payload.quantity != null) {
    lines.push(`Ordered quantity: ${payload.quantity}`)
  }
  if (activity.template_name) {
    lines.push(`Template: ${activity.template_name}`)
  }
  return lines
}

export const ProductionRunActivityTimeline = ({ runId }: { runId: string }) => {
  const [limit, setLimit] = useState(PAGE_SIZE)

  const {
    activities = [],
    count = 0,
    isLoading,
    isError,
  } = useProductionRunActivities(
    runId,
    { limit },
    { enabled: !!runId }
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Activity</Heading>
        {count > 0 && (
          <Text size="small" className="text-ui-fg-muted">
            {count} {count === 1 ? "entry" : "entries"}
          </Text>
        )}
      </div>

      <div className="px-6 py-4">
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-ui-bg-component" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-ui-bg-component" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-ui-bg-component" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && isError && (
          <Text size="small" className="text-ui-fg-error">
            Could not load this run's activity.
          </Text>
        )}

        {!isLoading && !isError && activities.length === 0 && (
          <Text size="small" className="text-ui-fg-subtle">
            No activity recorded for this run yet.
          </Text>
        )}

        {!isLoading && !isError && activities.length > 0 && (
          <div className="relative flex flex-col gap-4">
            {/* The rail. Stops short of the last dot so it doesn't dangle. */}
            <div
              className="absolute left-[3px] top-2 w-px bg-ui-border-base"
              style={{ height: "calc(100% - 1.5rem)" }}
              aria-hidden
            />

            {activities.map((activity) => {
              const lines = detailLines(activity)
              const notable = NOTABLE_KINDS.has(activity.kind)

              return (
                <div key={activity.id} className="relative flex gap-3">
                  <div
                    className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full ring-2 ring-ui-bg-base ${
                      DOT_CLASS[activity.activity_type] || DOT_CLASS.system
                    }`}
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Text
                        size="small"
                        weight={notable ? "plus" : "regular"}
                        className={notable ? "text-ui-fg-base" : "text-ui-fg-subtle"}
                      >
                        {activity.summary || formatKind(activity.kind)}
                      </Text>
                      {activity.channel && (
                        <Badge size="2xsmall" color="grey">
                          {activity.channel}
                        </Badge>
                      )}
                      {activity.actor_type === "admin" && (
                        <Badge size="2xsmall" color="purple">
                          admin
                        </Badge>
                      )}
                    </div>

                    {lines.map((line, i) => (
                      <Text
                        key={i}
                        size="xsmall"
                        className="text-ui-fg-muted mt-0.5"
                      >
                        {line}
                      </Text>
                    ))}

                    <Text size="xsmall" className="text-ui-fg-muted mt-0.5">
                      {formatWhen(activity.occurred_at)}
                    </Text>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!isLoading && !isError && count > activities.length && (
          <div className="pt-4">
            <Button
              size="small"
              variant="secondary"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
            >
              Show older activity
            </Button>
          </div>
        )}
      </div>
    </Container>
  )
}

export default ProductionRunActivityTimeline
