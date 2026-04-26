import { useState } from "react"
import {
  Badge,
  Button,
  Text,
  toast,
} from "@medusajs/ui"
import { Prompt } from "@medusajs/ui"
import { AdminDesign } from "../../hooks/api/designs"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const designQueryKeys = queryKeysFactory("designs" as const)

interface BulkDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDesigns: AdminDesign[]
  onComplete: () => void
}

export const BulkDeleteDialog = ({
  open,
  onOpenChange,
  selectedDesigns,
  onComplete,
}: BulkDeleteDialogProps) => {
  const queryClient = useQueryClient()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)

    let successCount = 0
    let failCount = 0

    for (const design of selectedDesigns) {
      try {
        await sdk.client.fetch(`/admin/designs/${design.id}`, {
          method: "DELETE",
        })
        successCount++
      } catch {
        failCount++
      }
    }

    setIsDeleting(false)

    if (successCount > 0) {
      toast.success(
        `${successCount} design${successCount > 1 ? "s" : ""} deleted`
      )
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
    }
    if (failCount > 0) {
      toast.error(
        `${failCount} design${failCount > 1 ? "s" : ""} failed to delete`
      )
    }

    onOpenChange(false)
    onComplete()
  }

  return (
    <Prompt open={open} onOpenChange={onOpenChange}>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>Delete Designs</Prompt.Title>
          <Prompt.Description>
            Are you sure you want to delete {selectedDesigns.length} design
            {selectedDesigns.length > 1 ? "s" : ""}? This action cannot be
            undone.
          </Prompt.Description>
        </Prompt.Header>
        <div className="px-6 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {selectedDesigns.map((d) => (
              <Badge key={d.id} size="2xsmall" color="red">
                {d.name || d.id}
              </Badge>
            ))}
          </div>
        </div>
        <Prompt.Footer>
          <Prompt.Cancel>Cancel</Prompt.Cancel>
          <Prompt.Action onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete"}
          </Prompt.Action>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}
