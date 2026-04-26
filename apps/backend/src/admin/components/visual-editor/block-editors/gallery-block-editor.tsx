import { Input, Button, Select, Text } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { BlockEditorProps } from "./index"

interface GalleryImage {
  url: string
  alt?: string
  caption?: string
}

export function GalleryBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const title = (content.title as string) || ""
  const images = (content.images as GalleryImage[]) || []
  const layout = (content.layout as string) || "grid"

  const updateField = (field: string, value: unknown) => {
    onContentChange({ ...content, [field]: value })
  }

  const updateImage = (index: number, updates: Partial<GalleryImage>) => {
    const newImages = [...images]
    newImages[index] = { ...newImages[index], ...updates }
    updateField("images", newImages)
  }

  const addImage = () => {
    updateField("images", [...images, { url: "", alt: "", caption: "" }])
  }

  const removeImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index)
    updateField("images", newImages)
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Gallery Title</label>
        <Input
          value={title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="Optional gallery title"
        />
      </div>

      {/* Layout */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Layout</label>
        <Select value={layout} onValueChange={(value) => updateField("layout", value)}>
          <Select.Trigger>
            <Select.Value placeholder="Select layout" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="grid">Grid</Select.Item>
            <Select.Item value="masonry">Masonry</Select.Item>
            <Select.Item value="carousel">Carousel</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {/* Images */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Images ({images.length})</label>
        <div className="space-y-3">
          {images.map((image, index) => (
            <div key={index} className="p-3 border rounded-lg bg-ui-bg-subtle">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  {/* Preview */}
                  {image.url && (
                    <div className="w-full h-20 rounded overflow-hidden bg-ui-bg-base">
                      <img
                        src={image.url}
                        alt={image.alt || "Preview"}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = "none"
                        }}
                      />
                    </div>
                  )}
                  <Input
                    value={image.url}
                    onChange={(e) => updateImage(index, { url: e.target.value })}
                    placeholder="Image URL"
                    size="small"
                  />
                  <Input
                    value={image.alt || ""}
                    onChange={(e) => updateImage(index, { alt: e.target.value })}
                    placeholder="Alt text"
                    size="small"
                  />
                  <Input
                    value={image.caption || ""}
                    onChange={(e) => updateImage(index, { caption: e.target.value })}
                    placeholder="Caption (optional)"
                    size="small"
                  />
                </div>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => removeImage(index)}
                  className="text-ui-fg-error"
                >
                  <Trash className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" size="small" onClick={addImage} className="w-full">
            <Plus className="w-4 h-4 mr-1" />
            Add Image
          </Button>
        </div>
      </div>
    </div>
  )
}
