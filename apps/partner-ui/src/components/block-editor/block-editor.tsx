import { useCallback, useState } from "react"
import { Text, Button, IconButton, Tooltip, Select } from "@medusajs/ui"
import { Trash, Plus, Images } from "@medusajs/icons"
import { ContentBlock } from "../../hooks/api/content"
import { TipTapEditor } from "../tiptap-editor/tiptap-editor"


type BlockEditorProps = {
  block: ContentBlock 
  onUpdate: (blockId: string, updates: Partial<ContentBlock>) => void
  onDelete: (blockId: string) => void
  saveStatus: "saved" | "saving" | "unsaved"
}

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase mb-1 block">
    {children}
  </Text>
)

const TextInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) => (
  <input
    className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
  />
)

const TextArea = ({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) => (
  <textarea
    className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm min-h-[60px]"
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
  />
)

const ImageUrlInput = ({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label?: string
}) => (
  <div>
    {label && <FieldLabel>{label}</FieldLabel>}
    <div className="flex gap-x-2 items-center">
      <input
        className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
        value={value}
        placeholder="https://..."
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <div className="w-10 h-10 rounded border border-ui-border-base overflow-hidden shrink-0">
          <img src={value} alt="" className="w-full h-full object-cover" />
        </div>
      )}
    </div>
  </div>
)

export const BlockEditor = ({
  block,
  onUpdate,
  onDelete,
  saveStatus,
}: BlockEditorProps) => {
  const updateContent = useCallback(
    (key: string, value: unknown) => {
      onUpdate(block.id, {
        content: { ...block.content, [key]: value },
      })
    },
    [block, onUpdate]
  )

  const updateSettings = useCallback(
    (key: string, value: unknown) => {
      onUpdate(block.id, {
        settings: { ...block.settings, [key]: value },
      })
    },
    [block, onUpdate]
  )

  const type = block.type
  const content = block.content || {}

  const renderTypeSpecificEditor = () => {
    switch (type) {
      case "Hero":
        return (
          <>
            <div>
              <FieldLabel>Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
                placeholder="Welcome to our store"
              />
            </div>
            <div>
              <FieldLabel>Subtitle</FieldLabel>
              <TextArea
                value={(content.subtitle as string) || ""}
                onChange={(v) => updateContent("subtitle", v)}
                placeholder="A short description"
              />
            </div>
            <div>
              <FieldLabel>Alignment</FieldLabel>
              <Select
                value={(content.align as string) || "center"}
                onValueChange={(v) => updateContent("align", v)}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Center" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="center">Center</Select.Item>
                  <Select.Item value="left">Left</Select.Item>
                </Select.Content>
              </Select>
            </div>
            <ImageUrlInput
              label="Background Image URL"
              value={(content.background_image_url as string) || ""}
              onChange={(v) => updateContent("background_image_url", v)}
            />
            <div>
              <FieldLabel>CTA Text</FieldLabel>
              <TextInput
                value={(content.cta_text as string) || ""}
                onChange={(v) => updateContent("cta_text", v)}
                placeholder="Shop Now"
              />
            </div>
            <div>
              <FieldLabel>CTA Link</FieldLabel>
              <TextInput
                value={(content.cta_link as string) || ""}
                onChange={(v) => updateContent("cta_link", v)}
                placeholder="/collections"
              />
            </div>
          </>
        )

      case "MainContent":
        return (
          <>
            <div>
              <FieldLabel>Section Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
                placeholder="About Us"
              />
            </div>
            <div>
              <FieldLabel>Body (Rich Text)</FieldLabel>
              <TipTapEditor
                content={(content.body as Record<string, unknown>) || undefined}
                onChange={(json) => updateContent("body", json)}
                placeholder="Write your page content here..."
              />
            </div>
          </>
        )

      case "Section":
        return (
          <>
            <div>
              <FieldLabel>Section Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
                placeholder="Our Story"
              />
            </div>
            <div>
              <FieldLabel>Body (Rich Text)</FieldLabel>
              <TipTapEditor
                content={(content.body as Record<string, unknown>) || undefined}
                onChange={(json) => updateContent("body", json)}
                placeholder="Write section content..."
              />
            </div>
            <div>
              <FieldLabel>Layout</FieldLabel>
              <Select
                value={(content.layout as string) || "full"}
                onValueChange={(v) => updateContent("layout", v)}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Full Width" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="full">Full Width</Select.Item>
                  <Select.Item value="split">Split</Select.Item>
                  <Select.Item value="image-left">Image Left</Select.Item>
                  <Select.Item value="image-right">Image Right</Select.Item>
                </Select.Content>
              </Select>
            </div>
            <ImageUrlInput
              label="Image URL"
              value={(content.image_url as string) || ""}
              onChange={(v) => updateContent("image_url", v)}
            />
          </>
        )

      case "Gallery":
        return <GalleryEditor block={block} onUpdate={onUpdate} />

      case "Feature":
        return (
          <>
            <div>
              <FieldLabel>Feature Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
                placeholder="Free Shipping"
              />
            </div>
            <div>
              <FieldLabel>Description</FieldLabel>
              <TextArea
                value={(content.description as string) || ""}
                onChange={(v) => updateContent("description", v)}
                placeholder="On all orders over $50"
              />
            </div>
            <ImageUrlInput
              label="Icon / Image URL"
              value={(content.image_url as string) || ""}
              onChange={(v) => updateContent("image_url", v)}
            />
          </>
        )

      case "Testimonial":
        return (
          <>
            <div>
              <FieldLabel>Quote</FieldLabel>
              <TextArea
                value={(content.quote as string) || ""}
                onChange={(v) => updateContent("quote", v)}
                placeholder="Amazing products!"
              />
            </div>
            <div>
              <FieldLabel>Author</FieldLabel>
              <TextInput
                value={(content.author as string) || ""}
                onChange={(v) => updateContent("author", v)}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <FieldLabel>Role</FieldLabel>
              <TextInput
                value={(content.role as string) || ""}
                onChange={(v) => updateContent("role", v)}
                placeholder="Customer"
              />
            </div>
            <ImageUrlInput
              label="Avatar URL"
              value={(content.avatar_url as string) || ""}
              onChange={(v) => updateContent("avatar_url", v)}
            />
          </>
        )

      case "Product":
        return (
          <>
            <div>
              <FieldLabel>Product Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
                placeholder="Featured Product"
              />
            </div>
            <div>
              <FieldLabel>Product ID or Handle</FieldLabel>
              <TextInput
                value={(content.product_handle as string) || ""}
                onChange={(v) => updateContent("product_handle", v)}
                placeholder="shirt"
              />
            </div>
            <ImageUrlInput
              label="Fallback Image URL"
              value={(content.image_url as string) || ""}
              onChange={(v) => updateContent("image_url", v)}
            />
          </>
        )

      case "ContactForm":
        return (
          <>
            <div>
              <FieldLabel>Form Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
                placeholder="Get in touch"
              />
            </div>
            <div>
              <FieldLabel>Description</FieldLabel>
              <TextArea
                value={(content.description as string) || ""}
                onChange={(v) => updateContent("description", v)}
                placeholder="We'd love to hear from you"
              />
            </div>
          </>
        )

      case "Header":
      case "Footer":
        return (
          <>
            <div>
              <FieldLabel>Text</FieldLabel>
              <TextInput
                value={(content.text as string) || ""}
                onChange={(v) => updateContent("text", v)}
                placeholder={type === "Header" ? "Store Name" : "Footer text"}
              />
            </div>
            <LinksEditor block={block} onUpdate={onUpdate} />
          </>
        )

      case "Custom":
        return (
          <>
            <div>
              <FieldLabel>Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
              />
            </div>
            <div>
              <FieldLabel>Body (Rich Text)</FieldLabel>
              <TipTapEditor
                content={(content.body as Record<string, unknown>) || undefined}
                onChange={(json) => updateContent("body", json)}
                placeholder="Write custom content..."
              />
            </div>
          </>
        )

      default:
        return (
          <>
            <div>
              <FieldLabel>Title</FieldLabel>
              <TextInput
                value={(content.title as string) || ""}
                onChange={(v) => updateContent("title", v)}
              />
            </div>
            <div>
              <FieldLabel>Body (Rich Text)</FieldLabel>
              <TipTapEditor
                content={(content.body as Record<string, unknown>) || undefined}
                onChange={(json) => updateContent("body", json)}
                placeholder="Write content..."
              />
            </div>
          </>
        )
    }
  }

  return (
    <div className="w-[340px] border-l border-ui-border-base overflow-y-auto bg-ui-bg-base p-4 shrink-0">
      <div className="flex items-center justify-between mb-4">
        <Text size="small" className="font-semibold">
          {block.type} Block
        </Text>
        <div className="flex items-center gap-x-2">
          <Text
            size="xsmall"
            className={
              saveStatus === "saved"
                ? "text-ui-fg-success"
                : saveStatus === "saving"
                  ? "text-ui-fg-muted"
                  : "text-ui-fg-error"
            }
          >
            {saveStatus === "saved"
              ? "Saved"
              : saveStatus === "saving"
                ? "Saving..."
                : "Unsaved"}
          </Text>
          <Tooltip content="Delete block">
            <IconButton
              variant="transparent"
              size="small"
              onClick={() => onDelete(block.id)}
            >
              <Trash />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <FieldLabel>Block Name</FieldLabel>
          <TextInput
            value={block.name}
            onChange={(v) => onUpdate(block.id, { name: v })}
          />
        </div>

        <div>
          <FieldLabel>Status</FieldLabel>
          <Select
            value={block.status}
            onValueChange={(v) => onUpdate(block.id, { status: v as ContentBlock["status"] })}
          >
            <Select.Trigger>
              <Select.Value placeholder="Active" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="Active">Active</Select.Item>
              <Select.Item value="Inactive">Inactive</Select.Item>
              <Select.Item value="Draft">Draft</Select.Item>
            </Select.Content>
          </Select>
        </div>

        {renderTypeSpecificEditor()}

        <div className="pt-2 border-t border-ui-border-base">
          <FieldLabel>Background Color</FieldLabel>
          <div className="flex gap-x-2">
            <input
              className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
              value={(block.settings?.backgroundColor as string) || ""}
              placeholder="#ffffff"
              onChange={(e) => updateSettings("backgroundColor", e.target.value)}
            />
            <input
              type="color"
              value={(block.settings?.backgroundColor as string) || "#ffffff"}
              onChange={(e) => updateSettings("backgroundColor", e.target.value)}
              className="w-9 h-9 rounded border border-ui-border-base cursor-pointer"
            />
          </div>
        </div>

        <div>
          <FieldLabel>Padding (px)</FieldLabel>
          <TextInput
            value={(block.settings?.padding as string) || ""}
            placeholder="0"
            onChange={(v) => updateSettings("padding", v)}
          />
        </div>

        <div>
          <FieldLabel>Max Width</FieldLabel>
          <Select
            value={(block.settings?.max_width as string) || "default"}
            onValueChange={(v) => updateSettings("max_width", v)}
          >
            <Select.Trigger>
              <Select.Value placeholder="Default" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="default">Default</Select.Item>
              <Select.Item value="narrow">Narrow</Select.Item>
              <Select.Item value="wide">Wide</Select.Item>
              <Select.Item value="full">Full Width</Select.Item>
            </Select.Content>
          </Select>
        </div>
      </div>
    </div>
  )
}

const GalleryEditor = ({
  block,
  onUpdate,
}: {
  block: ContentBlock
  onUpdate: (blockId: string, updates: Partial<ContentBlock>) => void
}) => {
  const images = (block.content?.images as Array<{ url?: string; alt?: string }>) || []
  const [newUrl, setNewUrl] = useState("")

  const updateImages = (imgs: Array<{ url?: string; alt?: string }>) => {
    onUpdate(block.id, {
      content: { ...block.content, images: imgs },
    })
  }

  const addImage = () => {
    if (!newUrl.trim()) return
    updateImages([...images, { url: newUrl.trim(), alt: "" }])
    setNewUrl("")
  }

  const removeImage = (index: number) => {
    updateImages(images.filter((_, i) => i !== index))
  }

  return (
    <>
      <div>
        <FieldLabel>Gallery Images</FieldLabel>
        <div className="flex gap-x-2 mb-2">
          <input
            className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
            value={newUrl}
            placeholder="https://..."
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addImage()
            }}
          />
          <Button size="small" variant="secondary" onClick={addImage}>
            <Plus className="mr-1" />Add
          </Button>
        </div>
        <div className="space-y-2">
          {images.map((img, idx) => (
            <div key={idx} className="flex gap-x-2 items-center">
              {img.url && (
                <div className="w-10 h-10 rounded border border-ui-border-base overflow-hidden shrink-0">
                  <img src={img.url} alt={img.alt || ""} className="w-full h-full object-cover" />
                </div>
              )}
              <input
                className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
                value={img.url || ""}
                placeholder="Image URL"
                onChange={(e) => {
                  const next = [...images]
                  next[idx] = { ...next[idx], url: e.target.value }
                  updateImages(next)
                }}
              />
              <IconButton
                variant="transparent"
                size="small"
                onClick={() => removeImage(idx)}
              >
                <Trash />
              </IconButton>
            </div>
          ))}
          {images.length === 0 && (
            <Text size="xsmall" className="text-ui-fg-muted flex items-center gap-x-1">
              <Images className="w-4 h-4" /> No images yet
            </Text>
          )}
        </div>
      </div>
      <div>
        <FieldLabel>Columns</FieldLabel>
        <Select
          value={(block.settings?.columns as string) || "3"}
          onValueChange={(v) =>
            onUpdate(block.id, {
              settings: { ...block.settings, columns: v },
            })
          }
        >
          <Select.Trigger>
            <Select.Value placeholder="3 Columns" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="2">2 Columns</Select.Item>
            <Select.Item value="3">3 Columns</Select.Item>
            <Select.Item value="4">4 Columns</Select.Item>
          </Select.Content>
        </Select>
      </div>
    </>
  )
}

const LinksEditor = ({
  block,
  onUpdate,
}: {
  block: ContentBlock
  onUpdate: (blockId: string, updates: Partial<ContentBlock>) => void
}) => {
  const links = (block.content?.links as Array<{ label?: string; href?: string }>) || []

  const updateLinks = (next: Array<{ label?: string; href?: string }>) => {
    onUpdate(block.id, {
      content: { ...block.content, links: next },
    })
  }

  return (
    <div>
      <FieldLabel>Navigation Links</FieldLabel>
      <div className="space-y-2">
        {links.map((link, idx) => (
          <div key={idx} className="flex gap-x-1">
            <input
              className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm"
              value={link.label || ""}
              placeholder="Label"
              onChange={(e) => {
                const next = [...links]
                next[idx] = { ...next[idx], label: e.target.value }
                updateLinks(next)
              }}
            />
            <input
              className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm"
              value={link.href || ""}
              placeholder="/link"
              onChange={(e) => {
                const next = [...links]
                next[idx] = { ...next[idx], href: e.target.value }
                updateLinks(next)
              }}
            />
            <IconButton
              variant="transparent"
              size="small"
              onClick={() => updateLinks(links.filter((_, i) => i !== idx))}
            >
              <Trash />
            </IconButton>
          </div>
        ))}
        <Button
          size="small"
          variant="secondary"
          onClick={() => updateLinks([...links, { label: "", href: "" }])}
        >
          <Plus className="mr-1" />Add Link
        </Button>
      </div>
    </div>
  )
}
