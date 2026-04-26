import { Input, Textarea } from "@medusajs/ui"
import { BlockEditorProps } from "./index"

export function HeaderBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const announcement = (content.announcement as string) || ""

  const updateField = (field: string, value: unknown) => {
    onContentChange({ ...content, [field]: value })
  }

  return (
    <div className="space-y-4">
      {/* Announcement */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Announcement Banner</label>
        <Textarea
          value={announcement}
          onChange={(e) => updateField("announcement", e.target.value)}
          placeholder="Enter announcement text that appears in the header"
          rows={2}
        />
      </div>
    </div>
  )
}
