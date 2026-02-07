import { Input, Textarea } from "@medusajs/ui"
import { BlockEditorProps } from "./index"

export function FooterBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const cta = content.cta as {
    subheading?: string
    content?: string
    actionline?: string
    button?: string
  } | undefined

  const updateCTA = (field: string, value: string) => {
    onContentChange({
      ...content,
      cta: { ...cta, [field]: value },
    })
  }

  return (
    <div className="space-y-4">
      {/* CTA Section */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">CTA Subheading</label>
        <Input
          value={cta?.subheading || ""}
          onChange={(e) => updateCTA("subheading", e.target.value)}
          placeholder="e.g., Ready to get started?"
        />
      </div>

      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">CTA Content</label>
        <Textarea
          value={cta?.content || ""}
          onChange={(e) => updateCTA("content", e.target.value)}
          placeholder="Main CTA text"
          rows={3}
        />
      </div>

      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Action Line</label>
        <Input
          value={cta?.actionline || ""}
          onChange={(e) => updateCTA("actionline", e.target.value)}
          placeholder="e.g., Start your free trial today"
        />
      </div>

      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Button Text</label>
        <Input
          value={cta?.button || ""}
          onChange={(e) => updateCTA("button", e.target.value)}
          placeholder="e.g., Get Started"
        />
      </div>
    </div>
  )
}
