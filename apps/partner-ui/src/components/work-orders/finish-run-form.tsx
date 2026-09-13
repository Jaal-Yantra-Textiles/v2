import {
  Button,
  Checkbox,
  Drawer,
  Text,
  Textarea,
} from "@medusajs/ui"
import { ExclamationCircle } from "@medusajs/icons"
import { useState } from "react"

export const FinishRunForm = ({
  open,
  onOpenChange,
  pendingTasks,
  finishNotes,
  setFinishNotes,
  onConfirm,
  isLoading,
  isSample,
  consumptionCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingTasks: any[]
  finishNotes: string
  setFinishNotes: (v: string) => void
  onConfirm: () => void
  isLoading: boolean
  isSample: boolean
  consumptionCount: number
}) => {
  const [acknowledgedPending, setAcknowledgedPending] = useState(false)
  const hasPending = pendingTasks.length > 0
  const canConfirm = !hasPending || acknowledgedPending

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Mark as Finished</Drawer.Title>
          <Drawer.Description>
            The design will move to Technical Review for admin to inspect.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          {/* Sample run warning if no materials logged */}
          {isSample && consumptionCount === 0 && (
            <div className="flex items-start gap-x-3 rounded-xl border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
              <ExclamationCircle className="mt-0.5 shrink-0 text-ui-tag-orange-icon" />
              <div className="flex flex-col gap-y-0.5">
                <Text size="small" weight="plus">No materials logged yet</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  For sample runs, material usage data is needed for cost estimation. Consider logging materials before finishing.
                </Text>
              </div>
            </div>
          )}

          {hasPending && (
            <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
              <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                {pendingTasks.length} task(s) still pending
              </Text>
              <div className="flex flex-col gap-y-0.5 mb-3">
                {pendingTasks.map((t: any) => (
                  <Text key={t.id} size="xsmall" className="text-ui-fg-muted">
                    &bull; {t.title || t.id}
                  </Text>
                ))}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={acknowledgedPending}
                  onCheckedChange={(checked) => setAcknowledgedPending(!!checked)}
                />
                <Text size="xsmall">
                  I confirm these tasks are completed or not needed
                </Text>
              </label>
            </div>
          )}

          <div>
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
              Notes for reviewer (optional)
            </Text>
            <Textarea
              placeholder="Any notes about the finished work, issues encountered, etc."
              value={finishNotes}
              onChange={(e) => setFinishNotes(e.target.value)}
              rows={3}
            />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" size="small" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="small"
            isLoading={isLoading}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            Confirm & Mark Finished
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
