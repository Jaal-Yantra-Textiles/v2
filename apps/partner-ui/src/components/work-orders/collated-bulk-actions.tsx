import {
  Button,
  Checkbox,
  Container,
  Drawer,
  Heading,
  StatusBadge,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

import { usePartnerConsumptionLogs } from "../../hooks/api/partner-consumption-logs"
import { usePartnerDesign } from "../../hooks/api/partner-designs"
import { useCompletePartnerProductionRun } from "../../hooks/api/partner-production-runs"
import {
  ACTION_LABEL,
  BULK_LABEL,
  type BulkAction,
  type CollatedRun,
  nextActionFor,
} from "../../lib/collated-actions"
import { extractErrorMessage } from "../../lib/extract-error-message"
import type { RunActionKey } from "../../lib/run-phase"
import { runPartnerBadge } from "./collated-design-detail"
import { CompleteRunForm } from "./complete-run-form"

/**
 * #2357 — every design of a collated order on one panel: where each stands and
 * the one step it owes, with the button for it. The cards below still hold the
 * full detail; this is the answer to "what do I do next on this order".
 */
export const DesignsAtAGlance = ({
  items,
  quantities,
  busy,
  onAction,
}: {
  items: CollatedRun[]
  quantities: Record<string, number>
  busy: boolean
  onAction: (action: RunActionKey, item: CollatedRun) => void
}) => (
  <Container className="divide-y p-0">
    <div className="px-6 py-4">
      <Heading level="h2">Designs at a glance</Heading>
    </div>
    {items.map((item) => {
      const action = nextActionFor(item)
      const badge = runPartnerBadge(item.run)
      return (
        <div
          key={item.lineId}
          data-glance-run-id={String(item.run?.id)}
          className="flex items-center gap-x-3 px-6 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <Text size="small" weight="plus" className="truncate">
              {item.name}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Qty {quantities[item.lineId] ?? 0}
              {item.run?.run_type === "sample" ? " · Sample" : ""}
            </Text>
          </div>
          <StatusBadge color={badge.color} className="shrink-0">
            {badge.label}
          </StatusBadge>
          {action ? (
            <Button
              size="small"
              variant="secondary"
              disabled={busy}
              onClick={() => onAction(action, item)}
              className="shrink-0"
            >
              {ACTION_LABEL[action]}
            </Button>
          ) : (
            <span className="w-[72px] shrink-0" />
          )}
        </div>
      )
    })}
  </Container>
)

/** The "Actions for all designs" bar: one button per action some design owes. */
export const BulkActionsBar = ({
  bulk,
  busy,
  onPick,
}: {
  bulk: BulkAction[]
  busy: boolean
  onPick: (b: BulkAction) => void
}) => (
  <div className="bg-ui-bg-subtle shadow-elevation-card-rest flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3">
    <Text size="small" weight="plus" className="text-ui-fg-subtle">
      Actions for all designs
    </Text>
    <div className="flex flex-wrap gap-2">
      {bulk.map((b) => (
        <Button
          key={b.action}
          size="small"
          variant="secondary"
          disabled={busy}
          onClick={() => onPick(b)}
        >
          {BULK_LABEL[b.action]} ({b.runs.length})
        </Button>
      ))}
    </div>
  </div>
)

/**
 * Which designs? Every design that owes the action, ticked; untick to leave one
 * out. Finish carries one shared note and the pending-task acknowledgement
 * across all of them; Complete hands off to the per-design walk.
 */
export const BulkActionDrawer = ({
  bulk,
  busy,
  onClose,
  onConfirm,
}: {
  bulk: BulkAction | null
  busy: boolean
  onClose: () => void
  onConfirm: (runs: CollatedRun[], notes?: string) => void
}) => {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    setChosen(new Set(bulk?.runs.map((r) => r.lineId) ?? []))
    setNotes("")
    setAcknowledged(false)
  }, [bulk])

  if (!bulk) return null
  const picked = bulk.runs.filter((r) => chosen.has(r.lineId))
  const pendingTasks =
    bulk.action === "finish"
      ? picked.flatMap((r) =>
          (r.run?.tasks ?? [])
            .filter((t: any) => t.status !== "completed" && t.status !== "cancelled")
            .map((t: any) => ({ ...t, design: r.name }))
        )
      : []
  const canConfirm =
    picked.length > 0 && (pendingTasks.length === 0 || acknowledged)

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {bulk.runs.length === 1
              ? `${ACTION_LABEL[bulk.action]} ${bulk.runs[0].name}`
              : `${BULK_LABEL[bulk.action]}: which designs?`}
          </Drawer.Title>
          <Drawer.Description>
            {bulk.action === "complete"
              ? "You'll fill the completion form for each design in turn."
              : "Untick a design to leave it out."}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <div className="flex flex-col gap-y-2">
            {bulk.runs.map((r) => (
              <label
                key={r.lineId}
                data-bulk-run-id={String(r.run?.id)}
                className="flex cursor-pointer items-center gap-x-3"
              >
                <Checkbox
                  checked={chosen.has(r.lineId)}
                  onCheckedChange={(c) =>
                    setChosen((prev) => {
                      const next = new Set(prev)
                      if (c) next.add(r.lineId)
                      else next.delete(r.lineId)
                      return next
                    })
                  }
                />
                <div className="flex flex-col">
                  <Text size="small" weight="plus">
                    {r.name}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {r.run?.run_type === "sample" ? "Sample" : "Production"} ·{" "}
                    {Number(r.run?.quantity) || 0} pcs
                  </Text>
                </div>
              </label>
            ))}
          </div>

          {pendingTasks.length > 0 && (
            <div className="border-ui-border-base bg-ui-bg-subtle rounded-xl border px-4 py-3">
              <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                {pendingTasks.length} task(s) still pending
              </Text>
              <div className="mb-3 flex flex-col gap-y-0.5">
                {pendingTasks.map((t: any) => (
                  <Text key={t.id} size="xsmall" className="text-ui-fg-muted">
                    &bull; {t.design}: {t.title || t.id}
                  </Text>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(c) => setAcknowledged(!!c)}
                />
                <Text size="xsmall">I confirm these tasks are completed or not needed</Text>
              </label>
            </div>
          )}

          {bulk.action === "finish" && (
            <div>
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
                Notes for reviewer (optional, sent with every design)
              </Text>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="small"
            isLoading={busy}
            disabled={!canConfirm}
            onClick={() => onConfirm(picked, notes.trim() || undefined)}
          >
            {ACTION_LABEL[bulk.action]} {picked.length}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/**
 * One design's completion form, as a step of "Complete all". Mount it with
 * `key={run.id}` so each design starts from a blank form — one design's
 * quantities and cost must never carry into the next.
 */
export const CompleteStep = ({
  item,
  position,
  total,
  onDone,
  onStop,
}: {
  item: CollatedRun
  position: number
  total: number
  onDone: () => void
  onStop: () => void
}) => {
  const runId = String(item.run.id)
  const designId = String(item.run.design_id ?? "")
  const { design } = usePartnerDesign(designId, { enabled: !!designId })
  const { count = 0 } = usePartnerConsumptionLogs(designId, undefined, {
    enabled: !!designId,
  })
  const complete = useCompletePartnerProductionRun(runId)

  if (!design) return null
  return (
    <CompleteRunForm
      run={item.run}
      design={design}
      open
      onOpenChange={(o) => !o && onStop()}
      isLoading={complete.isPending}
      isSample={item.run?.run_type === "sample"}
      existingConsumptionCount={count}
      title={total > 1 ? `Complete ${position} of ${total} · ${item.name}` : `Complete ${item.name}`}
      onComplete={async (body) => {
        try {
          const result = await complete.mutateAsync(body)
          const submitted = body?.consumptions?.length || 0
          const logged = (result as any)?.consumptions_logged || 0
          if (submitted > 0 && logged < submitted) {
            toast.warning(
              `${item.name}: ${logged} of ${submitted} material entries were recorded — check inventory items.`
            )
          }
          toast.success(`${item.name} completed`)
          onDone()
        } catch (e) {
          toast.error(extractErrorMessage(e))
        }
      }}
    />
  )
}
