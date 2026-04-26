import { Input, Textarea, Button, Select } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { BlockEditorProps } from "./index"

interface BentoCard {
  eyebrow: string
  title: string
  description: string
  graphic_type: "image" | "component"
  graphic_url?: string
  fade?: ("top" | "bottom")[]
  className?: string
}

export function BentoBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const title = (content.title as string) || ""
  const subtitle = (content.subtitle as string) || ""
  const cards = (content.cards as BentoCard[]) || []

  const updateField = (field: string, value: unknown) => {
    onContentChange({ ...content, [field]: value })
  }

  const updateCard = (index: number, updates: Partial<BentoCard>) => {
    const newCards = [...cards]
    newCards[index] = { ...newCards[index], ...updates }
    updateField("cards", newCards)
  }

  const addCard = () => {
    updateField("cards", [
      ...cards,
      {
        eyebrow: "Label",
        title: "Card Title",
        description: "Card description goes here",
        graphic_type: "image",
        graphic_url: "",
      },
    ])
  }

  const removeCard = (index: number) => {
    const newCards = cards.filter((_, i) => i !== index)
    updateField("cards", newCards)
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
        <Input
          value={subtitle}
          onChange={(e) => updateField("subtitle", e.target.value)}
          placeholder="Enter subtitle"
        />
      </div>

      {/* Cards */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Cards ({cards.length})</label>
        <div className="space-y-3">
          {cards.map((card, index) => (
            <div key={index} className="p-3 border rounded-lg bg-ui-bg-subtle">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Input
                    value={card.eyebrow}
                    onChange={(e) => updateCard(index, { eyebrow: e.target.value })}
                    placeholder="Eyebrow label"
                    size="small"
                  />
                  <Input
                    value={card.title}
                    onChange={(e) => updateCard(index, { title: e.target.value })}
                    placeholder="Card title"
                    size="small"
                  />
                  <Textarea
                    value={card.description}
                    onChange={(e) => updateCard(index, { description: e.target.value })}
                    placeholder="Card description"
                    rows={2}
                  />
                  <Select
                    value={card.graphic_type}
                    onValueChange={(value) => updateCard(index, { graphic_type: value as "image" | "component" })}
                    size="small"
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Graphic type" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="image">Image</Select.Item>
                      <Select.Item value="component">Component</Select.Item>
                    </Select.Content>
                  </Select>
                  {card.graphic_type === "image" && (
                    <Input
                      value={card.graphic_url || ""}
                      onChange={(e) => updateCard(index, { graphic_url: e.target.value })}
                      placeholder="Image URL"
                      size="small"
                    />
                  )}
                </div>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => removeCard(index)}
                  className="text-ui-fg-error"
                >
                  <Trash className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" size="small" onClick={addCard} className="w-full">
            <Plus className="w-4 h-4 mr-1" />
            Add Card
          </Button>
        </div>
      </div>
    </div>
  )
}
