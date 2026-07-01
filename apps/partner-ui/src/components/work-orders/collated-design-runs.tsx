import { TriangleDownMini, TriangleRightMini } from "@medusajs/icons"
import { Container, Heading, StatusBadge, Text, clx } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"

import {
  CollatedLine,
  DesignLineDetail,
  designLineTitle,
  runPartnerBadge,
  useDesignLineRun,
} from "./collated-design-detail"

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
  const [activeId, setActiveId] = useState<string>(String(lines[0]?.id))
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
  const runLines = (lines ?? []).filter(
    (l) => l?.metadata?.production_run_id && l?.metadata?.design_id
  )

  const [mode, setMode] = useState<ViewMode>(() => readStoredMode(orderId))
  useEffect(() => {
    if (orderId && typeof window !== "undefined") {
      window.localStorage.setItem(`${STORAGE_PREFIX}${orderId}`, mode)
    }
  }, [mode, orderId])

  if (!runLines.length) {
    return null
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center justify-between px-1">
        <Text size="small" weight="plus" className="text-ui-fg-subtle">
          Production ({runLines.length})
        </Text>
        {runLines.length > 1 && <ModeToggle mode={mode} onChange={setMode} />}
      </div>

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
