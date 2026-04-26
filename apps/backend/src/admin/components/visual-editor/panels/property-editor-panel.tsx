import { useState, useEffect, useCallback, useRef } from "react"
import { Text, Button, Badge, Input, Textarea, IconButton } from "@medusajs/ui"
import { XMark, Trash, CheckCircleSolid, ArrowPath } from "@medusajs/icons"
import { AdminBlock } from "../../../hooks/api/blocks"
import { getBlockEditor, BlockEditorProps } from "../block-editors"

interface PropertyEditorPanelProps {
  block: AdminBlock
  websiteId: string
  pageId: string
  onUpdate: (updates: Partial<AdminBlock>) => void
  onDelete: () => void
  onClose: () => void
  saveStatus: "saved" | "saving" | "unsaved"
}

export function PropertyEditorPanel({
  block,
  websiteId,
  pageId,
  onUpdate,
  onDelete,
  onClose,
  saveStatus,
}: PropertyEditorPanelProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [localContent, setLocalContent] = useState(block.content || {})
  const [localSettings, setLocalSettings] = useState(block.settings || {})
  const [localName, setLocalName] = useState(block.name)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Sync local state when block changes
  useEffect(() => {
    setLocalContent(block.content || {})
    setLocalSettings(block.settings || {})
    setLocalName(block.name)
  }, [block.id, block.content, block.settings, block.name])

  // Debounced update function
  const debouncedUpdate = useCallback(
    (updates: Partial<AdminBlock>) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      debounceRef.current = setTimeout(() => {
        onUpdate(updates)
      }, 800)
    },
    [onUpdate]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const handleNameChange = (value: string) => {
    setLocalName(value)
    debouncedUpdate({ name: value })
  }

  const handleContentChange = (newContent: Record<string, unknown>) => {
    setLocalContent(newContent)
    debouncedUpdate({ content: newContent })
  }

  const handleSettingsChange = (newSettings: Record<string, unknown>) => {
    setLocalSettings(newSettings)
    debouncedUpdate({ settings: newSettings })
  }

  const handleDelete = () => {
    if (showDeleteConfirm) {
      onDelete()
    } else {
      setShowDeleteConfirm(true)
    }
  }

  // Get the appropriate block editor component
  const BlockEditor = getBlockEditor(block.type)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border-base">
        <div className="flex items-center gap-2">
          <Badge color="grey" size="small">
            {block.type}
          </Badge>
          <SaveStatusIndicator status={saveStatus} />
        </div>
        <IconButton variant="transparent" size="small" onClick={onClose}>
          <XMark />
        </IconButton>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Block Name */}
        <div className="mb-4">
          <div className="text-ui-fg-muted text-xs font-semibold uppercase tracking-wide mb-2">Block Name</div>
          <Input
            value={localName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Enter block name"
          />
        </div>

        {/* Type-Specific Editor */}
        <div className="mb-4">
          <div className="text-ui-fg-muted text-xs font-semibold uppercase tracking-wide mb-2">Content</div>
          <BlockEditor
            block={block}
            content={localContent}
            settings={localSettings}
            onContentChange={handleContentChange}
            onSettingsChange={handleSettingsChange}
          />
        </div>

        {/* Settings Section */}
        <div className="mb-4">
          <div className="text-ui-fg-muted text-xs font-semibold uppercase tracking-wide mb-2">Settings</div>
          <SettingsEditor
            settings={localSettings}
            onChange={handleSettingsChange}
          />
        </div>
      </div>

      {/* Footer - Delete Action */}
      <div className="p-4 border-t border-ui-border-base">
        {showDeleteConfirm ? (
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-error">
              Are you sure?
            </Text>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="small"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="small"
                onClick={handleDelete}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="small"
            className="w-full"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash className="w-4 h-4 mr-2" />
            Delete Block
          </Button>
        )}
      </div>
    </div>
  )
}

function SaveStatusIndicator({ status }: { status: "saved" | "saving" | "unsaved" }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs ${
      status === "saved" ? "text-ui-fg-success" :
      status === "saving" ? "text-ui-fg-muted" :
      "text-ui-fg-error"
    }`}>
      {status === "saved" && (
        <>
          <CheckCircleSolid />
          <span>Saved</span>
        </>
      )}
      {status === "saving" && (
        <>
          <ArrowPath className="animate-spin" />
          <span>Saving...</span>
        </>
      )}
      {status === "unsaved" && (
        <>
          <span className="w-2 h-2 rounded-full bg-ui-tag-red-icon" />
          <span>Unsaved</span>
        </>
      )}
    </div>
  )
}

interface SettingsEditorProps {
  settings: Record<string, unknown>
  onChange: (settings: Record<string, unknown>) => void
}

function SettingsEditor({ settings, onChange }: SettingsEditorProps) {
  const handleFieldChange = (key: string, value: string) => {
    onChange({ ...settings, [key]: value })
  }

  return (
    <div className="space-y-3">
      <div className="mb-3">
        <label className="text-ui-fg-subtle text-xs font-medium mb-1 block">Background Color</label>
        <div className="flex gap-2">
          <Input
            value={(settings.backgroundColor as string) || ""}
            onChange={(e) => handleFieldChange("backgroundColor", e.target.value)}
            placeholder="#ffffff"
            className="flex-1"
          />
          <input
            type="color"
            value={(settings.backgroundColor as string) || "#ffffff"}
            onChange={(e) => handleFieldChange("backgroundColor", e.target.value)}
            className="w-10 h-10 rounded border border-ui-border-base cursor-pointer"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="text-ui-fg-subtle text-xs font-medium mb-1 block">Text Color</label>
        <div className="flex gap-2">
          <Input
            value={(settings.textColor as string) || ""}
            onChange={(e) => handleFieldChange("textColor", e.target.value)}
            placeholder="#000000"
            className="flex-1"
          />
          <input
            type="color"
            value={(settings.textColor as string) || "#000000"}
            onChange={(e) => handleFieldChange("textColor", e.target.value)}
            className="w-10 h-10 rounded border border-ui-border-base cursor-pointer"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="text-ui-fg-subtle text-xs font-medium mb-1 block">Padding</label>
        <Input
          value={(settings.padding as string) || ""}
          onChange={(e) => handleFieldChange("padding", e.target.value)}
          placeholder="e.g., 2rem or 32px"
        />
      </div>
    </div>
  )
}
