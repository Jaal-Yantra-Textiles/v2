import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { ReactNode, useState } from "react"

import {
  AdminProductionRunActivity,
  useProductionRunActivities,
} from "../../hooks/api/production-runs"
import {
  useGoodsTransfers,
  type AdminGoodsTransfer,
} from "../../hooks/api/goods-transfers"

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
  "goods_transfer_cancelled",
])

/**
 * The goods-movement kinds (#1246 / #891 / #1542).
 *
 * 🔑 `_received` and `_delivered` are listed here BEFORE anything writes them.
 * #891 S3 — the receive route — is still open, so no transfer can reach
 * `delivered` today. Naming the kinds now means S3 ships a route and this
 * timeline already renders it; the alternative is a second pass over this file
 * by whoever writes S3, which is how a kind ends up rendering as
 * "goods transfer received" in raw snake case forever.
 */
const TRANSFER_KINDS: Record<string, { dot: string; verb: string }> = {
  goods_transfer_shipped: { dot: "bg-ui-tag-blue-icon", verb: "Shipped" },
  goods_transfer_recorded: { dot: "bg-ui-tag-blue-icon", verb: "Recorded" },
  goods_transfer_received: { dot: "bg-ui-tag-green-icon", verb: "Received" },
  goods_transfer_delivered: { dot: "bg-ui-tag-green-icon", verb: "Delivered" },
  goods_transfer_cancelled: { dot: "bg-ui-tag-red-icon", verb: "Cancelled" },
}

const isTransferKind = (kind?: string | null) =>
  !!kind && kind in TRANSFER_KINDS

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
 *
 * Transfer kinds carry their own richer block (see `TransferDetails`), so the
 * fields it already prints — `reason`, the cancellation record — are skipped
 * here rather than printed twice.
 */
const detailLines = (activity: AdminProductionRunActivity): string[] => {
  const payload = activity.payload || {}
  const lines: string[] = []
  const transfer = isTransferKind(activity.kind)

  if (payload.reason && !transfer) {
    lines.push(`Reason: ${payload.reason}`)
  }
  if (payload.notes) {
    lines.push(String(payload.notes))
  }
  if (payload.rejection_reason) {
    lines.push(`Rejected: ${payload.rejection_reason}`)
  }
  if (payload.cancelled_reason && !transfer) {
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

const shortDate = (value?: string | null) => {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * One end of a cancelled → re-booked chain, said in words rather than as an id.
 *
 * 🔑 The raw `gtrf_01KZP7C2SJ…` the section prints is technically the answer and
 * practically unreadable — two 26-character ULIDs differing in the middle are
 * the same string to a human eye. Given the transfer we can say what it WAS,
 * which is the thing an operator is actually trying to establish: that the
 * 4 units on this row are the same 4 units that failed a fortnight ago, not
 * four more.
 *
 * Falls back to the id when the transfer is not in the list (deleted, or a
 * chain that reaches off this run) — an unresolvable id is still better than
 * dropping the link silently.
 */
const describeTransfer = (
  id: string,
  byId: Map<string, AdminGoodsTransfer>
): string => {
  const t = byId.get(id)
  if (!t) return id
  const when = shortDate(t.shipped_at || t.created_at)
  const units = `${t.quantity} unit${Number(t.quantity) === 1 ? "" : "s"}`
  return `the ${units} hop${when ? ` of ${when}` : ""} (${t.status.replace("_", " ")})`
}

/**
 * The goods-movement block: the lane, the waybill, the chain, the assertion.
 *
 * The activity `summary` already reads as a sentence — "4 units shipped
 * Shramdaan → Dharamshala via Delhivery (AWB 41712510000114)" — so this does
 * not repeat it. It adds what a sentence cannot carry: a clickable waybill, the
 * link to the hop this one replaces, and the fact that a carrier cancellation
 * is an ASSERTION somebody made rather than something we observed.
 */
const TransferDetails = ({
  activity,
  byId,
}: {
  activity: AdminProductionRunActivity
  byId: Map<string, AdminGoodsTransfer>
}): ReactNode => {
  const payload = (activity.payload || {}) as Record<string, any>
  const transferId = payload.goods_transfer_id
    ? String(payload.goods_transfer_id)
    : null
  const transfer = transferId ? byId.get(transferId) : undefined
  const meta = (transfer?.metadata ?? {}) as Record<string, any>

  const awb = payload.awb ? String(payload.awb) : null
  const trackingUrl = payload.tracking_url ? String(payload.tracking_url) : null
  const carrier = payload.carrier ? String(payload.carrier) : null

  const replaces = payload.replaces_transfer_id ?? meta.replaces_transfer_id
  const replacedBy = meta.replaced_by_transfer_id

  const cancellationReason =
    payload.cancellation_reason ?? meta.cancellation_reason
  const asserted =
    payload.carrier_cancellation_asserted ?? meta.carrier_cancellation_asserted

  /**
   * A shortfall on receipt. Nothing writes this yet (#891 S3), but the shape is
   * the same one `received_quantity` already has on the model, so it renders
   * the day the route lands.
   */
  const received = payload.received_quantity ?? transfer?.received_quantity
  const shortfall =
    received != null &&
    payload.quantity != null &&
    Number(received) < Number(payload.quantity)

  const rows: ReactNode[] = []

  if (carrier || awb) {
    rows.push(
      <span key="awb">
        {carrier && <span className="capitalize">{carrier}</span>}
        {carrier && awb && " · "}
        {awb &&
          (trackingUrl ? (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover underline"
            >
              AWB {awb}
            </a>
          ) : (
            <>AWB {awb}</>
          ))}
      </span>
    )
  }

  if (payload.reason) {
    rows.push(<span key="reason">Reason: {String(payload.reason)}</span>)
  }

  if (received != null) {
    rows.push(
      <span key="received" className={shortfall ? "text-ui-fg-error" : undefined}>
        Received {String(received)} of {String(payload.quantity ?? "?")}
        {shortfall ? " — short" : ""}
      </span>
    )
  }

  if (replaces) {
    rows.push(
      <span key="replaces" title={String(replaces)}>
        Re-books {describeTransfer(String(replaces), byId)}
      </span>
    )
  }
  if (replacedBy) {
    rows.push(
      <span key="replacedBy" title={String(replacedBy)}>
        Replaced by {describeTransfer(String(replacedBy), byId)}
      </span>
    )
  }

  if (cancellationReason) {
    rows.push(<span key="why">Cancelled: {String(cancellationReason)}</span>)
  }

  /**
   * 🔴 The provenance line, and the reason the timeline is the right home for
   * it. `POST .../cancel` does NOT call the carrier — it records that a human
   * says the carrier already did. An operator who read this row as a carrier
   * fact would stop chasing a waybill that is still live.
   */
  if (asserted) {
    rows.push(
      <span key="asserted" className="italic">
        Recorded by an admin — the carrier was not called.
      </span>
    )
  }

  if (!rows.length) return null

  return (
    <>
      {rows.map((row, i) => (
        <Text key={i} size="xsmall" className="text-ui-fg-muted mt-0.5">
          {row}
        </Text>
      ))}
    </>
  )
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

  /**
   * The transfers, to resolve a chain into words and to reach metadata the
   * activity payload never carried.
   *
   * 🔑 This costs nothing: `GoodsTransferSection` on the same page already runs
   * this exact query, and react-query dedupes on the key
   * (`goodsTransferQueryKeys.list(runId)`). It is one request, read twice.
   *
   * It is also why the #891 pair — cancelled 25 Aug, re-booked the same day,
   * both rows already in the database — reads as a chain here without any
   * backfill. `replaces_transfer_id` was never written into the ACTIVITY
   * payload, only onto the transfer, so an implementation that read the payload
   * alone would render nothing for every hop that exists today and look correct
   * doing it.
   */
  const { goods_transfers: transfers = [] } = useGoodsTransfers(runId, {
    enabled: !!runId,
  } as any)

  const transfersById = new Map<string, AdminGoodsTransfer>(
    (transfers as AdminGoodsTransfer[]).map((t) => [t.id, t])
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
              const transferKind = TRANSFER_KINDS[activity.kind]

              return (
                <div key={activity.id} className="relative flex gap-3">
                  <div
                    className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full ring-2 ring-ui-bg-base ${
                      transferKind?.dot ||
                      DOT_CLASS[activity.activity_type] ||
                      DOT_CLASS.system
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
                      {transferKind && (
                        <Badge size="2xsmall" color="grey">
                          {transferKind.verb}
                        </Badge>
                      )}
                    </div>

                    {transferKind && (
                      <TransferDetails activity={activity} byId={transfersById} />
                    )}

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
