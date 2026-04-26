import { useState, useMemo, useCallback } from "react"
import {
  Badge,
  Button,
  Drawer,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { XMark } from "@medusajs/icons"
import { AdminDesign } from "../../hooks/api/designs"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const designQueryKeys = queryKeysFactory("designs" as const)

type TagMode = "add" | "replace"

interface BulkAssignTagsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDesigns: AdminDesign[]
  onComplete: () => void
}

export const BulkAssignTagsDrawer = ({
  open,
  onOpenChange,
  selectedDesigns,
  onComplete,
}: BulkAssignTagsDrawerProps) => {
  const queryClient = useQueryClient()

  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [mode, setMode] = useState<TagMode>("add")
  const [isSending, setIsSending] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const existingTags = useMemo(() => {
    const all = selectedDesigns.flatMap((d) => d.tags || [])
    return [...new Set(all)]
  }, [selectedDesigns])

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed])
    }
    setTagInput("")
  }, [tagInput, tags])

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addTag()
    }
  }

  const handleSubmit = async () => {
    if (!tags.length) {
      toast.error("Please add at least one tag")
      return
    }

    setIsSending(true)
    setProgress({ done: 0, total: selectedDesigns.length })

    let successCount = 0
    let failCount = 0

    for (const design of selectedDesigns) {
      try {
        const newTags =
          mode === "add"
            ? [...new Set([...(design.tags || []), ...tags])]
            : [...tags]

        await sdk.client.fetch(`/admin/designs/${design.id}`, {
          method: "PUT",
          body: { tags: newTags },
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
        `Tags ${mode === "add" ? "added to" : "replaced on"} ${successCount} design${successCount > 1 ? "s" : ""}`
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
    setTags([])
    setTagInput("")
    setMode("add")
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Assign Tags</Drawer.Title>
          <Drawer.Description>
            Manage tags for {selectedDesigns.length} design
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

          {existingTags.length > 0 && (
            <div>
              <Text
                size="small"
                weight="plus"
                className="text-ui-fg-subtle mb-1.5"
              >
                Existing Tags
              </Text>
              <div className="flex flex-wrap gap-1.5">
                {existingTags.map((tag) => (
                  <Badge key={tag} size="2xsmall" color="grey">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="mb-1.5">Mode</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("add")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "add"
                    ? "bg-ui-bg-interactive text-ui-fg-on-color"
                    : "bg-ui-bg-component hover:bg-ui-bg-component-hover text-ui-fg-base"
                }`}
              >
                Add to existing
              </button>
              <button
                type="button"
                onClick={() => setMode("replace")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "replace"
                    ? "bg-ui-bg-interactive text-ui-fg-on-color"
                    : "bg-ui-bg-component hover:bg-ui-bg-component-hover text-ui-fg-base"
                }`}
              >
                Replace all
              </button>
            </div>
          </div>

          <div>
            <Label className="mb-1.5">Tags</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Type a tag and press Enter..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={addTag}
                disabled={!tagInput.trim()}
              >
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} size="2xsmall" color="green" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-0.5 inline-flex"
                    >
                      <XMark className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

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
          <Button
            onClick={handleSubmit}
            disabled={!tags.length || isSending}
          >
            {isSending
              ? `Updating ${progress.done}/${progress.total}...`
              : `${mode === "add" ? "Add" : "Replace"} Tags on ${selectedDesigns.length} Design${selectedDesigns.length > 1 ? "s" : ""}`}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
