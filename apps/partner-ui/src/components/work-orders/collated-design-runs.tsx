import { TriangleDownMini, TriangleRightMini } from "@medusajs/icons"
import { Container, Heading, StatusBadge, Text, clx, toast, usePrompt } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"

import { useBatchAdvancePartnerRuns } from "../../hooks/api/partner-production-runs"
import {
  ACTION_LABEL,
  type BulkAction,
  type CollatedRun,
  bulkActions,
  describeBulkFailures,
} from "../../lib/collated-actions"
import type { RunActionKey } from "../../lib/run-phase"
import {
  BulkActionDrawer,
  BulkActionsBar,
  CompleteStep,
  DesignsAtAGlance,
} from "./collated-bulk-actions"
import { useOfferPaymentRequest } from "./use-offer-payment-request"
import {
  CollatedLine,
  DesignLineDetail,
  designLineTitle,
  runPartnerBadge,
  useDesignLineRun,
} from "./collated-design-detail"

// Invisible per-line probe: reads the (cache-shared) run for a line and reports
// it up so the orchestrator can offer a batch action without re-fetching.
const RunProbe = ({
  line,
  onRun,
}: {
  line: CollatedLine
  onRun: (lineId: string, run: any) => void
}) => {
  const { production_run } = useDesignLineRun(line)
  useEffect(() => {
    if (production_run) onRun(String(line.id), production_run)
  }, [production_run, line.id, onRun])
  return null
}

/**
 * #826 — the production surface of a COLLATED design work-order. Every design's
 * specs + full lifecycle (runs, tasks) render INLINE in the one order span
 * (never navigating out to production-runs / tasks screens), styled like the
 * Medusa core order page (stacked Containers + SectionRows).
 *
 * The operator can switch how the N designs are laid out — the choice is
 * remembered PER ORDER (localStorage) so different orders can read differently:
 *   • expandable — collapsible Container per design (default; scales to many)
 *   • stacked    — every design expanded, mirroring the single-design order
 *   • focus      — a compact list; one selected design's detail below
 */

type ViewMode = "expandable" | "stacked" | "focus"

const MODES: { value: ViewMode; label: string }[] = [
  { value: "expandable", label: "Expandable" },
  { value: "stacked", label: "Stacked" },
  { value: "focus", label: "Focus" },
]

const STORAGE_PREFIX = "collated-design-view:"

const readStoredMode = (orderId?: string): ViewMode => {
  if (!orderId || typeof window === "undefined") return "expandable"
  const v = window.localStorage.getItem(`${STORAGE_PREFIX}${orderId}`)
  return v === "stacked" || v === "focus" ? v : "expandable"
}

// ── Compact status/qty summary shared by headers + list rows ──────────

const DesignLineHeadline = ({ line }: { line: CollatedLine }) => {
  const { production_run } = useDesignLineRun(line)
  const quantity = Number(line?.quantity) || 0
  const badge = production_run ? runPartnerBadge(production_run) : null
  return (
    <div className="flex min-w-0 flex-1 items-center gap-x-3">
      <Heading level="h3" className="truncate">
        {designLineTitle(line, production_run)}
      </Heading>
      <Text size="xsmall" className="text-ui-fg-subtle shrink-0">
        Qty {quantity}
      </Text>
      {badge && (
        <StatusBadge color={badge.color} className="shrink-0">
          {badge.label}
        </StatusBadge>
      )}
    </div>
  )
}

// ── Mode toggle (segmented button group, Medusa tokens) ───────────────

const ModeToggle = ({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (m: ViewMode) => void
}) => (
  <div className="border-ui-border-base flex overflow-hidden rounded-lg border">
    {MODES.map((m, i) => (
      <button
        key={m.value}
        type="button"
        onClick={() => onChange(m.value)}
        className={clx(
          "txt-compact-small-plus px-3 py-1.5 transition-colors",
          i > 0 && "border-ui-border-base border-l",
          mode === m.value
            ? "bg-ui-bg-base-pressed text-ui-fg-base"
            : "bg-ui-bg-subtle text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
        )}
      >
        {m.label}
      </button>
    ))}
  </div>
)

// ── Expandable: collapsible Container per design ──────────────────────

const ExpandableDesignCard = ({
  line,
  defaultOpen,
  onActionSuccess,
}: {
  line: CollatedLine
  defaultOpen?: boolean
  onActionSuccess?: () => void
}) => {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <Container className="p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-ui-bg-base-hover flex w-full items-center gap-x-3 px-6 py-4 text-left transition-colors"
      >
        <span className="text-ui-fg-muted shrink-0">
          {open ? <TriangleDownMini /> : <TriangleRightMini />}
        </span>
        <DesignLineHeadline line={line} />
      </button>
      {open && (
        <div className="border-ui-border-base border-t p-4">
          <DesignLineDetail line={line} onActionSuccess={onActionSuccess} />
        </div>
      )}
    </Container>
  )
}

const ExpandableLayout = ({
  lines,
  onActionSuccess,
}: {
  lines: CollatedLine[]
  onActionSuccess?: () => void
}) => (
  <div className="flex flex-col gap-y-3">
    {lines.map((line, i) => (
      <ExpandableDesignCard
        key={String(line.id)}
        line={line}
        defaultOpen={i === 0}
        onActionSuccess={onActionSuccess}
      />
    ))}
  </div>
)

// ── Stacked: every design expanded (mirrors the single-design order) ──

const StackedLayout = ({
  lines,
  onActionSuccess,
}: {
  lines: CollatedLine[]
  onActionSuccess?: () => void
}) => (
  <div className="flex flex-col gap-y-4">
    {lines.map((line) => (
      <div key={String(line.id)} className="flex flex-col gap-y-3">
        <div className="px-1">
          <DesignLineHeadline line={line} />
        </div>
        <DesignLineDetail line={line} onActionSuccess={onActionSuccess} />
      </div>
    ))}
  </div>
)

// ── Focus: compact list + one selected design's detail ────────────────

const FocusRow = ({
  line,
  active,
  onSelect,
}: {
  line: CollatedLine
  active: boolean
  onSelect: () => void
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={clx(
      "flex w-full items-center gap-x-3 px-6 py-3 text-left transition-colors",
      active ? "bg-ui-bg-base-pressed" : "hover:bg-ui-bg-base-hover"
    )}
  >
    <span
      className={clx(
        "size-2 shrink-0 rounded-full",
        active ? "bg-ui-fg-interactive" : "bg-ui-border-strong"
      )}
    />
    <DesignLineHeadline line={line} />
  </button>
)

const FocusLayout = ({
  lines,
  onActionSuccess,
}: {
  lines: CollatedLine[]
  onActionSuccess?: () => void
}) => {
  const { id: orderId } = useParams()
  const focusKey = `collated-design-focus:${orderId}`
  const [activeId, setActiveId] = useState<string>(() => {
    if (orderId && typeof window !== "undefined") {
      const stored = window.localStorage.getItem(focusKey)
      if (stored && lines.some((l) => String(l.id) === stored)) return stored
    }
    return String(lines[0]?.id)
  })
  useEffect(() => {
    if (orderId && typeof window !== "undefined") {
      window.localStorage.setItem(focusKey, activeId)
    }
  }, [activeId, focusKey, orderId])
  const activeLine =
    lines.find((l) => String(l.id) === activeId) ?? lines[0]
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        {lines.map((line) => (
          <FocusRow
            key={String(line.id)}
            line={line}
            active={String(line.id) === String(activeLine?.id)}
            onSelect={() => setActiveId(String(line.id))}
          />
        ))}
      </Container>
      {activeLine && (
        <DesignLineDetail line={activeLine} onActionSuccess={onActionSuccess} />
      )}
    </div>
  )
}

// ── Orchestrator ──────────────────────────────────────────────────────

export const CollatedDesignRuns = ({
  lines,
  onActionSuccess,
}: {
  lines: Array<Record<string, any>>
  onActionSuccess?: () => void
}) => {
  const { id: orderId } = useParams()
  const prompt = usePrompt()
  const runLines = (lines ?? []).filter(
    (l) => l?.metadata?.production_run_id && l?.metadata?.design_id
  )

  const [mode, setMode] = useState<ViewMode>(() => readStoredMode(orderId))
  useEffect(() => {
    if (orderId && typeof window !== "undefined") {
      window.localStorage.setItem(`${STORAGE_PREFIX}${orderId}`, mode)
    }
  }, [mode, orderId])

  // #826 — collect each line's run (cache-shared with the cards) so the panel
  // and the all-designs bar can act without re-fetching.
  const [runsById, setRunsById] = useState<Record<string, any>>({})
  const collectRun = useCallback(
    (lineId: string, run: any) =>
      setRunsById((prev) => (prev[lineId] === run ? prev : { ...prev, [lineId]: run })),
    []
  )
  const batch = useBatchAdvancePartnerRuns()
  const offerPayment = useOfferPaymentRequest()

  // #2357 — one named entry per design, in order-line order.
  const items: CollatedRun[] = runLines
    .filter((line) => runsById[String(line.id)])
    .map((line) => ({
      lineId: String(line.id),
      run: runsById[String(line.id)],
      name: String(line.title || designLineTitle(line)),
    }))
  const quantities = Object.fromEntries(
    runLines.map((line) => [String(line.id), Number(line.quantity) || 0])
  )
  const bulk = bulkActions(items)

  const [drawer, setDrawer] = useState<BulkAction | null>(null)
  // Complete all: one design's form at a time.
  const [completeQueue, setCompleteQueue] = useState<CollatedRun[]>([])
  const [completeTotal, setCompleteTotal] = useState(0)
  const [completedIds, setCompletedIds] = useState<string[]>([])

  const runBatch = async (
    action: "accept" | "start" | "finish",
    runs: CollatedRun[],
    notes?: string
  ) => {
    try {
      const res = await batch.mutateAsync({
        items: runs.map((r) => ({ runId: String(r.run.id), action, notes })),
      })
      const failure = describeBulkFailures(runs, res.succeeded, res.failed)
      if (failure) toast.warning(failure)
      else
        toast.success(
          runs.length === 1
            ? `${runs[0].name}: ${ACTION_LABEL[action].toLowerCase()} done`
            : `${ACTION_LABEL[action]} done for ${runs.length} designs`
        )
      onActionSuccess?.()
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update the designs")
    }
  }

  const startComplete = (runs: CollatedRun[]) => {
    setCompletedIds([])
    setCompleteTotal(runs.length)
    setCompleteQueue(runs)
  }

  const finishComplete = (doneIds: string[]) => {
    setCompleteQueue([])
    onActionSuccess?.()
    if (doneIds.length) void offerPayment(doneIds)
  }

  // One design's button on the panel. Accept/Start confirm first (a click is
  // easy to mis-hit); Finish/Complete open their forms, which are the check.
  const actOnOne = async (action: RunActionKey, item: CollatedRun) => {
    if (action === "accept" || action === "start") {
      const confirmed = await prompt({
        title: `${ACTION_LABEL[action]} ${item.name}?`,
        description:
          action === "accept"
            ? `You'll be responsible for making ${Number(item.run?.quantity) || 0} piece(s).`
            : "Mark it started when you begin, so timelines stay accurate.",
        confirmText: ACTION_LABEL[action],
        cancelText: "Cancel",
        variant: "confirmation",
      })
      if (confirmed) await runBatch(action, [item])
      return
    }
    if (action === "finish") setDrawer({ action, runs: [item] })
    else startComplete([item])
  }

  if (!runLines.length) {
    return null
  }

  return (
    <div className="flex flex-col gap-y-3">
      {/* Invisible probes feed the batch bar without extra fetches. */}
      {runLines.map((line) => (
        <RunProbe key={`probe-${line.id}`} line={line} onRun={collectRun} />
      ))}
      <div className="flex items-center justify-between px-1">
        <Text size="small" weight="plus" className="text-ui-fg-subtle">
          Production ({runLines.length})
        </Text>
        {runLines.length > 1 && <ModeToggle mode={mode} onChange={setMode} />}
      </div>

      {/* #2357 — where every design stands, and what it owes. */}
      {items.length > 1 && (
        <DesignsAtAGlance
          items={items}
          quantities={quantities}
          busy={batch.isPending || completeQueue.length > 0}
          onAction={actOnOne}
        />
      )}
      {items.length > 1 && bulk.length > 0 && (
        <BulkActionsBar
          bulk={bulk}
          busy={batch.isPending || completeQueue.length > 0}
          onPick={setDrawer}
        />
      )}
      <BulkActionDrawer
        bulk={drawer}
        busy={batch.isPending}
        onClose={() => setDrawer(null)}
        onConfirm={async (runs, notes) => {
          const action = drawer?.action
          setDrawer(null)
          if (!action) return
          if (action === "complete") startComplete(runs)
          else await runBatch(action, runs, notes)
        }}
      />
      {completeQueue[0] && (
        <CompleteStep
          key={String(completeQueue[0].run.id)}
          item={completeQueue[0]}
          position={completedIds.length + 1}
          total={completeTotal}
          onDone={() => {
            const done = [...completedIds, String(completeQueue[0].run.id)]
            setCompletedIds(done)
            const rest = completeQueue.slice(1)
            if (rest.length) setCompleteQueue(rest)
            else finishComplete(done)
          }}
          onStop={() => {
            if (completeTotal > 1) {
              toast.info(
                `Stopped. ${completedIds.length} of ${completeTotal} designs completed; the rest are still open.`
              )
            }
            finishComplete(completedIds)
          }}
        />
      )}

      {mode === "stacked" ? (
        <StackedLayout lines={runLines} onActionSuccess={onActionSuccess} />
      ) : mode === "focus" ? (
        <FocusLayout lines={runLines} onActionSuccess={onActionSuccess} />
      ) : (
        <ExpandableLayout lines={runLines} onActionSuccess={onActionSuccess} />
      )}
    </div>
  )
}
