import { Input, Textarea, Button } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { BlockEditorProps } from "./index"

interface FeatureCard {
  title: string
  description: string
  icon?: string
}

export function FeatureBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const title = (content.title as string) || ""
  const subtitle = (content.subtitle as string) || ""
  const screenshot = content.screenshot as { url?: string } | undefined
  const features = (content.features as FeatureCard[]) || []

  const updateField = (field: string, value: unknown) => {
    onContentChange({ ...content, [field]: value })
  }

  const updateFeature = (index: number, updates: Partial<FeatureCard>) => {
    const newFeatures = [...features]
    newFeatures[index] = { ...newFeatures[index], ...updates }
    updateField("features", newFeatures)
  }

  const addFeature = () => {
    updateField("features", [
      ...features,
      { title: "New Feature", description: "Feature description", icon: "" },
    ])
  }

  const removeFeature = (index: number) => {
    const newFeatures = features.filter((_, i) => i !== index)
    updateField("features", newFeatures)
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Section Title</label>
        <Input
          value={title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="Enter section title"
        />
      </div>

      {/* Subtitle */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Subtitle</label>
        <Textarea
          value={subtitle}
          onChange={(e) => updateField("subtitle", e.target.value)}
          placeholder="Enter subtitle"
          rows={2}
        />
      </div>

      {/* Screenshot URL */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Screenshot Image URL</label>
        <Input
          value={screenshot?.url || ""}
          onChange={(e) => updateField("screenshot", { url: e.target.value })}
          placeholder="https://example.com/image.png"
        />
      </div>

      {/* Features */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Features</label>
        <div className="space-y-3">
          {features.map((feature, index) => (
            <div key={index} className="p-3 border rounded-lg bg-ui-bg-subtle">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Input
                    value={feature.title}
                    onChange={(e) => updateFeature(index, { title: e.target.value })}
                    placeholder="Feature title"
                    size="small"
                  />
                  <Textarea
                    value={feature.description}
                    onChange={(e) => updateFeature(index, { description: e.target.value })}
                    placeholder="Feature description"
                    rows={2}
                  />
                  <Input
                    value={feature.icon || ""}
                    onChange={(e) => updateFeature(index, { icon: e.target.value })}
                    placeholder="Icon name (optional)"
                    size="small"
                  />
                </div>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => removeFeature(index)}
                  className="text-ui-fg-error"
                >
                  <Trash className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" size="small" onClick={addFeature} className="w-full">
            <Plus className="w-4 h-4 mr-1" />
            Add Feature
          </Button>
        </div>
      </div>
    </div>
  )
}
