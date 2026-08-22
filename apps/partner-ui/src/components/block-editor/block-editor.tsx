import { useCallback, useState } from "react"
import { Text, Button, IconButton, Tooltip, Select, Badge, Label } from "@medusajs/ui"
import { Trash, Plus, Images, ChevronDown, ChevronRight, CursorArrowRays, ArrowUpMini, ArrowDownMini, ArrowsPointingOut } from "@medusajs/icons"
import { ContentBlock } from "../../hooks/api/content"
import { TipTapEditor, type TipTapActions } from "../tiptap-editor/tiptap-editor"


type BlockEditorProps = {
  block: ContentBlock
  onUpdate: (blockId: string, updates: Partial<ContentBlock>) => void
  onDelete: (blockId: string) => void
  onDuplicate?: (blockId: string) => void
  onMoveUp?: (blockId: string) => void
  onMoveDown?: (blockId: string) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  saveStatus: "saved" | "saving" | "unsaved"
  onEditorReady?: (editor: any, actions: TipTapActions) => void
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
  onDuplicate,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  saveStatus,
  onEditorReady,
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
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const REPEATABLE_TYPES = new Set([
    "Feature", "Gallery", "Testimonial", "Product", "Section", "Custom",
    "HeroWithImage", "BentoGrid", "Button",
  ])

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
                onEditorReady={onEditorReady}
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
                onEditorReady={onEditorReady}
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

      case "HeroWithImage":
        return <HeroWithImageEditor content={content} updateContent={updateContent} />

      case "BentoGrid":
        return <BentoGridEditor content={content} updateContent={updateContent} />

      case "Button":
        return <ButtonBlockEditor content={content} updateContent={updateContent} />

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
                onEditorReady={onEditorReady}
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
                onEditorReady={onEditorReady}
              />
            </div>
          </>
        )
    }
  }

  return (
    <div className="w-[340px] border-l border-ui-border-base overflow-y-auto bg-ui-bg-base p-4 shrink-0">
      {/* Header: type badge + save status + actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-x-2">
          <Badge
            color={
              block.status === "Active" ? "green" : block.status === "Draft" ? "orange" : "grey"
            }
            size="2xsmall"
          >
            {block.type}
          </Badge>
          <Text size="small" className="font-semibold">
            {block.name || block.type}
          </Text>
        </div>
        <div className="flex items-center gap-x-1">
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
            {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving..." : "Unsaved"}
          </Text>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-x-1 mb-4 pb-3 border-b border-ui-border-base">
        {onMoveUp && (
          <Tooltip content="Move up">
            <IconButton variant="transparent" size="small" disabled={!canMoveUp} onClick={() => onMoveUp(block.id)}>
              <ArrowUpMini />
            </IconButton>
          </Tooltip>
        )}
        {onMoveDown && (
          <Tooltip content="Move down">
            <IconButton variant="transparent" size="small" disabled={!canMoveDown} onClick={() => onMoveDown(block.id)}>
              <ArrowDownMini />
            </IconButton>
          </Tooltip>
        )}
        {onDuplicate && REPEATABLE_TYPES.has(block.type) && (
          <Tooltip content="Duplicate block">
            <IconButton variant="transparent" size="small" onClick={() => onDuplicate(block.id)}>
              <Plus />
            </IconButton>
          </Tooltip>
        )}
        <div className="flex-1" />
        <Tooltip content="Delete block">
          <IconButton variant="transparent" size="small" onClick={() => onDelete(block.id)}>
            <Trash />
          </IconButton>
        </Tooltip>
      </div>

      {/* Inline editing hint */}
      <div className="flex items-center gap-x-2 mb-4 rounded-md bg-ui-bg-subtle p-2">
        <CursorArrowRays className="text-ui-fg-muted opacity-50 w-4 h-4 shrink-0" />
        <Text size="xsmall" className="text-ui-fg-subtle">
          Click text on the canvas to edit it inline. Use this panel for
          settings and complex fields.
        </Text>
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

        {/* Advanced settings (collapsible) */}
        <div className="pt-2 border-t border-ui-border-base">
          <button
            className="flex items-center gap-x-1 w-full text-left mb-2"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? <ChevronDown className="w-4 h-4 text-ui-fg-muted" /> : <ChevronRight className="w-4 h-4 text-ui-fg-muted" />}
            <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase">
              Advanced Settings
            </Text>
          </button>
          {advancedOpen && (
            <div className="space-y-3 pl-1">
              <div>
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
                <FieldLabel>Text Color</FieldLabel>
                <div className="flex gap-x-2">
                  <input
                    className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
                    value={(block.settings?.textColor as string) || ""}
                    placeholder="#000000"
                    onChange={(e) => updateSettings("textColor", e.target.value)}
                  />
                  <input
                    type="color"
                    value={(block.settings?.textColor as string) || "#000000"}
                    onChange={(e) => updateSettings("textColor", e.target.value)}
                    className="w-9 h-9 rounded border border-ui-border-base cursor-pointer"
                  />
                </div>
              </div>

              <SpacingControl
                label="Padding"
                value={(block.settings?.padding as string) || ""}
                top={(block.settings?.paddingTop as string) || ""}
                right={(block.settings?.paddingRight as string) || ""}
                bottom={(block.settings?.paddingBottom as string) || ""}
                left={(block.settings?.paddingLeft as string) || ""}
                onChangeAll={(v) => updateSettings("padding", v)}
                onChangeTop={(v) => updateSettings("paddingTop", v)}
                onChangeRight={(v) => updateSettings("paddingRight", v)}
                onChangeBottom={(v) => updateSettings("paddingBottom", v)}
                onChangeLeft={(v) => updateSettings("paddingLeft", v)}
              />

              <SpacingControl
                label="Margin"
                value={(block.settings?.margin as string) || ""}
                top={(block.settings?.marginTop as string) || ""}
                right={(block.settings?.marginRight as string) || ""}
                bottom={(block.settings?.marginBottom as string) || ""}
                left={(block.settings?.marginLeft as string) || ""}
                onChangeAll={(v) => updateSettings("margin", v)}
                onChangeTop={(v) => updateSettings("marginTop", v)}
                onChangeRight={(v) => updateSettings("marginRight", v)}
                onChangeBottom={(v) => updateSettings("marginBottom", v)}
                onChangeLeft={(v) => updateSettings("marginLeft", v)}
              />

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
                    <Select.Item value="narrow">Narrow (680px)</Select.Item>
                    <Select.Item value="medium">Medium (960px)</Select.Item>
                    <Select.Item value="wide">Wide (1200px)</Select.Item>
                    <Select.Item value="full">Full Width</Select.Item>
                  </Select.Content>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-x-2">
                <div>
                  <FieldLabel>Width (px)</FieldLabel>
                  <TextInput
                    value={(block.settings?.width as string) || ""}
                    placeholder="auto"
                    onChange={(v) => updateSettings("width", v)}
                  />
                </div>
                <div>
                  <FieldLabel>Height (px)</FieldLabel>
                  <TextInput
                    value={(block.settings?.height as string) || ""}
                    placeholder="auto"
                    onChange={(v) => updateSettings("height", v)}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Border Radius (px)</FieldLabel>
                <input
                  type="range"
                  min="0"
                  max="32"
                  value={Number((block.settings?.borderRadius as string) || "0")}
                  onChange={(e) => updateSettings("borderRadius", e.target.value)}
                  className="w-full"
                />
                <Text size="xsmall" className="text-ui-fg-muted">
                  {((block.settings?.borderRadius as string) || "0")}px
                </Text>
              </div>

              <div className="grid grid-cols-2 gap-x-2">
                <div>
                  <FieldLabel>Border Width</FieldLabel>
                  <TextInput
                    value={(block.settings?.borderWidth as string) || ""}
                    placeholder="0"
                    onChange={(v) => updateSettings("borderWidth", v)}
                  />
                </div>
                <div>
                  <FieldLabel>Border Color</FieldLabel>
                  <input
                    className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
                    value={(block.settings?.borderColor as string) || ""}
                    placeholder="#e5e7eb"
                    onChange={(e) => updateSettings("borderColor", e.target.value)}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Box Shadow</FieldLabel>
                <TextInput
                  value={(block.settings?.boxShadow as string) || ""}
                  placeholder="e.g. 0 4px 6px rgba(0,0,0,0.1)"
                  onChange={(v) => updateSettings("boxShadow", v)}
                />
              </div>

              <div>
                <FieldLabel>Aspect Ratio</FieldLabel>
                <TextInput
                  value={(block.settings?.aspectRatio as string) || ""}
                  placeholder="e.g. 16/9"
                  onChange={(v) => updateSettings("aspectRatio", v)}
                />
              </div>
            </div>
          )}
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

const HeroWithImageEditor = ({
  content,
  updateContent,
}: {
  content: Record<string, unknown>
  updateContent: (key: string, value: unknown) => void
}) => {
  const buttons = (content.buttons as Array<{ label?: string; href?: string; variant?: string }>) || []

  const updateButtons = (next: Array<{ label?: string; href?: string; variant?: string }>) => {
    updateContent("buttons", next)
  }

  return (
    <>
      <div>
        <FieldLabel>Eyebrow Text</FieldLabel>
        <TextInput
          value={(content.eyebrow as string) || ""}
          onChange={(v) => updateContent("eyebrow", v)}
          placeholder="New Collection"
        />
      </div>
      <div>
        <FieldLabel>Title</FieldLabel>
        <TextInput
          value={(content.title as string) || ""}
          onChange={(v) => updateContent("title", v)}
          placeholder="Hero Title"
        />
      </div>
      <div>
        <FieldLabel>Subtitle</FieldLabel>
        <TextArea
          value={(content.subtitle as string) || ""}
          onChange={(v) => updateContent("subtitle", v)}
          placeholder="Hero subtitle text"
        />
      </div>
      <div>
        <FieldLabel>Layout</FieldLabel>
        <Select
          value={(content.layout as string) || "image-right"}
          onValueChange={(v) => updateContent("layout", v)}
        >
          <Select.Trigger>
            <Select.Value placeholder="Image Right" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="image-right">Image Right</Select.Item>
            <Select.Item value="image-left">Image Left</Select.Item>
          </Select.Content>
        </Select>
      </div>
      <ImageUrlInput
        label="Image URL"
        value={(content.image_url as string) || ""}
        onChange={(v) => updateContent("image_url", v)}
      />
      <div>
        <FieldLabel>Image Alt Text</FieldLabel>
        <TextInput
          value={(content.image_alt as string) || ""}
          onChange={(v) => updateContent("image_alt", v)}
          placeholder="Describe the image"
        />
      </div>
      <div>
        <FieldLabel>Buttons</FieldLabel>
        <div className="space-y-2">
          {buttons.map((btn, idx) => (
            <div key={idx} className="rounded-md border border-ui-border-base p-2 space-y-2">
              <div className="flex gap-x-1">
                <input
                  className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm"
                  value={btn.label || ""}
                  placeholder="Label"
                  onChange={(e) => {
                    const next = [...buttons]
                    next[idx] = { ...next[idx], label: e.target.value }
                    updateButtons(next)
                  }}
                />
                <input
                  className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm"
                  value={btn.href || ""}
                  placeholder="/link"
                  onChange={(e) => {
                    const next = [...buttons]
                    next[idx] = { ...next[idx], href: e.target.value }
                    updateButtons(next)
                  }}
                />
                <IconButton
                  variant="transparent"
                  size="small"
                  onClick={() => updateButtons(buttons.filter((_, i) => i !== idx))}
                >
                  <Trash />
                </IconButton>
              </div>
              <Select
                value={btn.variant || "primary"}
                onValueChange={(v) => {
                  const next = [...buttons]
                  next[idx] = { ...next[idx], variant: v }
                  updateButtons(next)
                }}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Primary" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="primary">Primary</Select.Item>
                  <Select.Item value="secondary">Secondary</Select.Item>
                </Select.Content>
              </Select>
            </div>
          ))}
          <Button
            size="small"
            variant="secondary"
            onClick={() => updateButtons([...buttons, { label: "", href: "", variant: "primary" }])}
          >
            <Plus className="mr-1" />Add Button
          </Button>
        </div>
      </div>
    </>
  )
}

const BentoGridEditor = ({
  content,
  updateContent,
}: {
  content: Record<string, unknown>
  updateContent: (key: string, value: unknown) => void
}) => {
  const cards = (content.cards as Array<{
    eyebrow?: string
    title?: string
    description?: string
    image_url?: string
    col_span?: string
    row_span?: string
    bg_color?: string
    text_color?: string
  }>) || []

  const updateCards = (next: typeof cards) => {
    updateContent("cards", next)
  }

  return (
    <>
      <div>
        <FieldLabel>Title</FieldLabel>
        <TextInput
          value={(content.title as string) || ""}
          onChange={(v) => updateContent("title", v)}
          placeholder="Bento Grid Title"
        />
      </div>
      <div>
        <FieldLabel>Subtitle</FieldLabel>
        <TextInput
          value={(content.subtitle as string) || ""}
          onChange={(v) => updateContent("subtitle", v)}
          placeholder="Optional subtitle"
        />
      </div>
      <div>
        <FieldLabel>Columns</FieldLabel>
        <Select
          value={(content.columns as string) || "3"}
          onValueChange={(v) => updateContent("columns", v)}
        >
          <Select.Trigger>
            <Select.Value placeholder="3" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="2">2 Columns</Select.Item>
            <Select.Item value="3">3 Columns</Select.Item>
            <Select.Item value="4">4 Columns</Select.Item>
          </Select.Content>
        </Select>
      </div>
      <div>
        <FieldLabel>Cards</FieldLabel>
        <div className="space-y-3">
          {cards.map((card, idx) => (
            <div key={idx} className="rounded-md border border-ui-border-base p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Text size="xsmall" className="font-semibold text-ui-fg-muted">
                  Card {idx + 1}
                </Text>
                <IconButton
                  variant="transparent"
                  size="small"
                  onClick={() => updateCards(cards.filter((_, i) => i !== idx))}
                >
                  <Trash />
                </IconButton>
              </div>
              <TextInput
                value={card.eyebrow || ""}
                onChange={(v) => {
                  const next = [...cards]
                  next[idx] = { ...next[idx], eyebrow: v }
                  updateCards(next)
                }}
                placeholder="Eyebrow (small label)"
              />
              <TextInput
                value={card.title || ""}
                onChange={(v) => {
                  const next = [...cards]
                  next[idx] = { ...next[idx], title: v }
                  updateCards(next)
                }}
                placeholder="Card title"
              />
              <TextArea
                value={card.description || ""}
                onChange={(v) => {
                  const next = [...cards]
                  next[idx] = { ...next[idx], description: v }
                  updateCards(next)
                }}
                placeholder="Card description"
              />
              <ImageUrlInput
                label="Image URL"
                value={card.image_url || ""}
                onChange={(v) => {
                  const next = [...cards]
                  next[idx] = { ...next[idx], image_url: v }
                  updateCards(next)
                }}
              />
              <div className="grid grid-cols-2 gap-x-2">
                <div>
                  <FieldLabel>Col Span</FieldLabel>
                  <Select
                    value={card.col_span || "1"}
                    onValueChange={(v) => {
                      const next = [...cards]
                      next[idx] = { ...next[idx], col_span: v }
                      updateCards(next)
                    }}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="1" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="1">1</Select.Item>
                      <Select.Item value="2">2</Select.Item>
                      <Select.Item value="3">3</Select.Item>
                      <Select.Item value="4">4</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
                <div>
                  <FieldLabel>Row Span</FieldLabel>
                  <Select
                    value={card.row_span || "1"}
                    onValueChange={(v) => {
                      const next = [...cards]
                      next[idx] = { ...next[idx], row_span: v }
                      updateCards(next)
                    }}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="1" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="1">1</Select.Item>
                      <Select.Item value="2">2</Select.Item>
                      <Select.Item value="3">3</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-2">
                <div>
                  <FieldLabel>Card BG</FieldLabel>
                  <input
                    className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm"
                    value={card.bg_color || ""}
                    placeholder="#f5f5f5"
                    onChange={(e) => {
                      const next = [...cards]
                      next[idx] = { ...next[idx], bg_color: e.target.value }
                      updateCards(next)
                    }}
                  />
                </div>
                <div>
                  <FieldLabel>Card Text</FieldLabel>
                  <input
                    className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm"
                    value={card.text_color || ""}
                    placeholder="#000000"
                    onChange={(e) => {
                      const next = [...cards]
                      next[idx] = { ...next[idx], text_color: e.target.value }
                      updateCards(next)
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
          <Button
            size="small"
            variant="secondary"
            onClick={() => updateCards([...cards, { eyebrow: "", title: "New Card", description: "", col_span: "1", row_span: "1" }])}
          >
            <Plus className="mr-1" />Add Card
          </Button>
        </div>
      </div>
    </>
  )
}

const ButtonBlockEditor = ({
  content,
  updateContent,
}: {
  content: Record<string, unknown>
  updateContent: (key: string, value: unknown) => void
}) => {
  const buttons = (content.buttons as Array<{
    label?: string
    href?: string
    variant?: string
    size?: string
  }>) || []

  const updateButtons = (next: typeof buttons) => {
    updateContent("buttons", next)
  }

  return (
    <>
      <div>
        <FieldLabel>Alignment</FieldLabel>
        <Select
          value={(content.align as string) || "left"}
          onValueChange={(v) => updateContent("align", v)}
        >
          <Select.Trigger>
            <Select.Value placeholder="Left" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="left">Left</Select.Item>
            <Select.Item value="center">Center</Select.Item>
            <Select.Item value="right">Right</Select.Item>
          </Select.Content>
        </Select>
      </div>
      <div>
        <FieldLabel>Buttons</FieldLabel>
        <div className="space-y-2">
          {buttons.map((btn, idx) => (
            <div key={idx} className="rounded-md border border-ui-border-base p-2 space-y-2">
              <div className="flex gap-x-1">
                <input
                  className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm"
                  value={btn.label || ""}
                  placeholder="Button Label"
                  onChange={(e) => {
                    const next = [...buttons]
                    next[idx] = { ...next[idx], label: e.target.value }
                    updateButtons(next)
                  }}
                />
                <IconButton
                  variant="transparent"
                  size="small"
                  onClick={() => updateButtons(buttons.filter((_, i) => i !== idx))}
                >
                  <Trash />
                </IconButton>
              </div>
              <TextInput
                value={btn.href || ""}
                onChange={(v) => {
                  const next = [...buttons]
                  next[idx] = { ...next[idx], href: v }
                  updateButtons(next)
                }}
                placeholder="/link"
              />
              <div className="grid grid-cols-2 gap-x-2">
                <Select
                  value={btn.variant || "primary"}
                  onValueChange={(v) => {
                    const next = [...buttons]
                    next[idx] = { ...next[idx], variant: v }
                    updateButtons(next)
                  }}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Primary" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="primary">Primary</Select.Item>
                    <Select.Item value="secondary">Secondary</Select.Item>
                    <Select.Item value="ghost">Ghost</Select.Item>
                  </Select.Content>
                </Select>
                <Select
                  value={btn.size || "medium"}
                  onValueChange={(v) => {
                    const next = [...buttons]
                    next[idx] = { ...next[idx], size: v }
                    updateButtons(next)
                  }}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Medium" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="small">Small</Select.Item>
                    <Select.Item value="medium">Medium</Select.Item>
                    <Select.Item value="large">Large</Select.Item>
                  </Select.Content>
                </Select>
              </div>
            </div>
          ))}
          <Button
            size="small"
            variant="secondary"
            onClick={() => updateButtons([...buttons, { label: "", href: "#", variant: "primary", size: "medium" }])}
          >
            <Plus className="mr-1" />Add Button
          </Button>
        </div>
      </div>
    </>
  )
}

const SpacingControl = ({
  label,
  value,
  top,
  right,
  bottom,
  left,
  onChangeAll,
  onChangeTop,
  onChangeRight,
  onChangeBottom,
  onChangeLeft,
}: {
  label: string
  value: string
  top: string
  right: string
  bottom: string
  left: string
  onChangeAll: (v: string) => void
  onChangeTop: (v: string) => void
  onChangeRight: (v: string) => void
  onChangeBottom: (v: string) => void
  onChangeLeft: (v: string) => void
}) => {
  const [expanded, setExpanded] = useState(false)
  const hasPerSide = top || right || bottom || left
  const sliderVal = value ? Number(value) : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <FieldLabel>{label}</FieldLabel>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-x-0.5 text-ui-fg-muted hover:text-ui-fg-base"
        >
          <ArrowsPointingOut className="w-3.5 h-3.5" />
          <Text size="xsmall" className="text-ui-fg-muted">
            {expanded ? "Simple" : "Per side"}
          </Text>
        </button>
      </div>
      {expanded ? (
        <div className="grid grid-cols-2 gap-1">
          <div className="flex items-center gap-x-1">
            <Text size="xsmall" className="text-ui-fg-muted w-4">T</Text>
            <input
              className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm w-full"
              value={top}
              placeholder="0"
              onChange={(e) => onChangeTop(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-x-1">
            <Text size="xsmall" className="text-ui-fg-muted w-4">B</Text>
            <input
              className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm w-full"
              value={bottom}
              placeholder="0"
              onChange={(e) => onChangeBottom(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-x-1">
            <Text size="xsmall" className="text-ui-fg-muted w-4">L</Text>
            <input
              className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm w-full"
              value={left}
              placeholder="0"
              onChange={(e) => onChangeLeft(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-x-1">
            <Text size="xsmall" className="text-ui-fg-muted w-4">R</Text>
            <input
              className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm w-full"
              value={right}
              placeholder="0"
              onChange={(e) => onChangeRight(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-x-2">
          <input
            type="range"
            min="0"
            max="80"
            value={sliderVal}
            onChange={(e) => onChangeAll(e.target.value)}
            className="flex-1"
          />
          <Text size="small" className="text-ui-fg-muted w-10 text-right">
            {value || (hasPerSide ? "mixed" : "0")}px
          </Text>
        </div>
      )}
    </div>
  )
}
