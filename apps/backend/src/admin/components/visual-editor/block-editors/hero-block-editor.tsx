import { useState } from "react"
import { Input, Textarea, Button, Text, Select } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { BlockEditorProps } from "./index"

interface HeroButton {
  text: string
  link: string
  variant?: "primary" | "secondary"
}

export function HeroBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const title = (content.title as string) || ""
  const subtitle = (content.subtitle as string) || ""
  const announcement = (content.announcement as string) || ""
  const buttons = (content.buttons as HeroButton[]) || []

  const updateField = (field: string, value: unknown) => {
    onContentChange({ ...content, [field]: value })
  }

  const updateButton = (index: number, updates: Partial<HeroButton>) => {
    const newButtons = [...buttons]
    newButtons[index] = { ...newButtons[index], ...updates }
    updateField("buttons", newButtons)
  }

  const addButton = () => {
    updateField("buttons", [...buttons, { text: "New Button", link: "/", variant: "primary" }])
  }

  const removeButton = (index: number) => {
    const newButtons = buttons.filter((_, i) => i !== index)
    updateField("buttons", newButtons)
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Title</label>
        <Input
          value={title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="Enter hero title"
        />
      </div>

      {/* Subtitle */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Subtitle</label>
        <Textarea
          value={subtitle}
          onChange={(e) => updateField("subtitle", e.target.value)}
          placeholder="Enter hero subtitle"
          rows={3}
        />
      </div>

      {/* Announcement */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Announcement Banner</label>
        <Input
          value={announcement}
          onChange={(e) => updateField("announcement", e.target.value)}
          placeholder="Optional announcement text"
        />
      </div>

      {/* Buttons */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Buttons</label>
        <div className="space-y-3">
          {buttons.map((button, index) => (
            <div key={index} className="p-3 border rounded-lg bg-ui-bg-subtle">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Input
                    value={button.text}
                    onChange={(e) => updateButton(index, { text: e.target.value })}
                    placeholder="Button text"
                    size="small"
                  />
                  <Input
                    value={button.link}
                    onChange={(e) => updateButton(index, { link: e.target.value })}
                    placeholder="Button link (e.g., /about)"
                    size="small"
                  />
                  <Select
                    value={button.variant || "primary"}
                    onValueChange={(value) => updateButton(index, { variant: value as "primary" | "secondary" })}
                    size="small"
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Style" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="primary">Primary</Select.Item>
                      <Select.Item value="secondary">Secondary</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => removeButton(index)}
                  className="text-ui-fg-error"
                >
                  <Trash className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" size="small" onClick={addButton} className="w-full">
            <Plus className="w-4 h-4 mr-1" />
            Add Button
          </Button>
        </div>
      </div>
    </div>
  )
}
