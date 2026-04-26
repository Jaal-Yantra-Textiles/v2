import { useState } from "react"
import {
  Badge,
  Button,
  Drawer,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { AdminDesign } from "../../hooks/api/designs"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const designQueryKeys = queryKeysFactory("designs" as const)

const STATUS_OPTIONS = [
  { label: "Conceptual", value: "Conceptual" },
  { label: "In Development", value: "In_Development" },
  { label: "Technical Review", value: "Technical_Review" },
  { label: "Sample Production", value: "Sample_Production" },
  { label: "Revision", value: "Revision" },
  { label: "Approved", value: "Approved" },
  { label: "Commerce Ready", value: "Commerce_Ready" },
  { label: "Rejected", value: "Rejected" },
  { label: "On Hold", value: "On_Hold" },
] as const

interface BulkUpdateStatusDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDesigns: AdminDesign[]
  onComplete: () => void
}

export const BulkUpdateStatusDrawer = ({
  open,
  onOpenChange,
  selectedDesigns,
  onComplete,
}: BulkUpdateStatusDrawerProps) => {
  const queryClient = useQueryClient()

  const [status, setStatus] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const handleSubmit = async () => {
    if (!status) {
      toast.error("Please select a status")
      return
    }

    setIsSending(true)
    setProgress({ done: 0, total: selectedDesigns.length })

    let successCount = 0
    let failCount = 0

    for (const design of selectedDesigns) {
      try {
        await sdk.client.fetch(`/admin/designs/${design.id}`, {
          method: "PUT",
          body: { status },
        })
        successCount++
      } catch {
        failCount++
      }
      setProgress((prev) => ({ ...prev, done: prev.done + 1 }))
    }

    setIsSending(false)

    if (successCount > 0) {
      toast.success(
        `${successCount} design${successCount > 1 ? "s" : ""} updated to "${status.replace(/_/g, " ")}"`
      )
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
    }
    if (failCount > 0) {
      toast.error(
        `${failCount} design${failCount > 1 ? "s" : ""} failed to update`
      )
    }

    handleClose()
    onComplete()
  }

  const handleClose = () => {
    if (isSending) return
    setStatus("")
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Update Status</Drawer.Title>
          <Drawer.Description>
            Change status for {selectedDesigns.length} design
            {selectedDesigns.length > 1 ? "s" : ""}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <div>
            <Text
              size="small"
              weight="plus"
              className="text-ui-fg-subtle mb-2"
            >
              Selected Designs
            </Text>
            <div className="flex flex-wrap gap-1.5">
              {selectedDesigns.map((d) => (
                <Badge key={d.id} size="2xsmall" color="blue">
                  {d.name || d.id}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5">New Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <Select.Trigger>
                <Select.Value placeholder="Select status..." />
              </Select.Trigger>
              <Select.Content>
                {STATUS_OPTIONS.map((opt) => (
                  <Select.Item key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          {status && (
            <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
              <Text size="small" className="text-ui-fg-subtle">
                This will change the following designs:
              </Text>
              <div className="mt-2 flex flex-col gap-1">
                {selectedDesigns.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <span className="truncate">{d.name || d.id}</span>
                    <span className="text-ui-fg-muted">
                      {d.status?.replace(/_/g, " ")}
                    </span>
                    <span className="text-ui-fg-muted">&rarr;</span>
                    <Badge size="2xsmall" color="green">
                      {status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isSending && (
            <div className="rounded-md bg-ui-bg-subtle px-4 py-3">
              <Text size="small" weight="plus">
                Updating... {progress.done}/{progress.total}
              </Text>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-ui-bg-switch-off">
                <div
                  className="h-full rounded-full bg-ui-bg-interactive transition-all"
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!status || isSending}>
            {isSending
              ? `Updating ${progress.done}/${progress.total}...`
              : `Update ${selectedDesigns.length} Design${selectedDesigns.length > 1 ? "s" : ""}`}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
