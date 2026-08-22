import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import { useCallback, useState } from "react"
import { Button, Input, Label, Checkbox } from "@medusajs/ui"
import { StackedDrawer } from "../modals/stacked-drawer"
import { useStackedModal } from "../modals/stacked-modal-provider"

type TipTapEditorProps = {
  content?: Record<string, unknown>
  onChange?: (json: Record<string, unknown>) => void
  placeholder?: string
}

export const TipTapEditor = ({
  content,
  onChange,
  placeholder = "Start writing...",
}: TipTapEditorProps) => {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "tiptap-link" },
      }),
      Image.configure({
        HTMLAttributes: { class: "tiptap-image" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: content || { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON() as Record<string, unknown>)
    },
  })

  const [linkUrl, setLinkUrl] = useState("")
  const [linkOpenNewTab, setLinkOpenNewTab] = useState(false)
  const [imageUrl, setImageUrl] = useState("")
  const { setIsOpen: setStackedOpen } = useStackedModal()
  const LINK_MODAL_ID = "tiptap-link"
  const IMAGE_MODAL_ID = "tiptap-image"


  const sanitizeUrl = useCallback((url: string): string => {
    const trimmed = url.trim()
    if (!trimmed) return ""
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString()
      }
    } catch {
      return ""
    }
    return ""
  }, [])

  const setLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes("link").href || ""
    const isOpen = editor.getAttributes("link").target === "_blank"
    setLinkUrl(previousUrl)
    setLinkOpenNewTab(isOpen)
    setStackedOpen(LINK_MODAL_ID, true)
  }, [editor])

  const confirmSetLink = useCallback(() => {
    if (!editor) return
    const url = sanitizeUrl(linkUrl)
    setStackedOpen(LINK_MODAL_ID, false)
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({
        href: url,
        target: linkOpenNewTab ? "_blank" : null,
      })
      .run()
  }, [editor, linkUrl, linkOpenNewTab, sanitizeUrl])

  const addImage = useCallback(() => {
    if (!editor) return
    setImageUrl("")
    setStackedOpen(IMAGE_MODAL_ID, true)
  }, [editor])

  const confirmAddImage = useCallback(() => {
    const url = sanitizeUrl(imageUrl)
    setStackedOpen(IMAGE_MODAL_ID, false)
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor, imageUrl, sanitizeUrl])

  if (!editor) return null

  const ToolbarButton = ({
    label,
    onClick,
    isActive,
  }: {
    label: string
    onClick: () => void
    isActive?: boolean
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded text-sm transition-colors ${
        isActive
          ? "bg-ui-bg-highlight text-ui-fg-base border border-ui-border-strong"
          : "hover:bg-ui-bg-hover text-ui-fg-subtle border border-transparent"
      }`}
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="rounded-md border border-ui-border-base overflow-hidden">
        <div className="flex flex-wrap gap-1 p-2 border-b border-ui-border-base bg-ui-bg-subtle">
          <ToolbarButton
            label="H1"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive("heading", { level: 1 })}
          />
          <ToolbarButton
            label="H2"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive("heading", { level: 2 })}
          />
          <ToolbarButton
            label="H3"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive("heading", { level: 3 })}
          />
          <ToolbarButton
            label="B"
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
          />
          <ToolbarButton
            label="I"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
          />
          <ToolbarButton
            label="U"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive("underline")}
          />
          <ToolbarButton
            label="UL"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
          />
          <ToolbarButton
            label="OL"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
          />
          <ToolbarButton
            label="Quote"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive("blockquote")}
          />
          <ToolbarButton
            label="Code"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive("codeBlock")}
          />
          <ToolbarButton label="Link" onClick={setLink} isActive={editor.isActive("link")} />
          <ToolbarButton label="Image" onClick={addImage} />
          <ToolbarButton
            label="Left"
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            isActive={editor.isActive({ textAlign: "left" })}
          />
          <ToolbarButton
            label="Center"
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            isActive={editor.isActive({ textAlign: "center" })}
          />
          <ToolbarButton
            label="Right"
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            isActive={editor.isActive({ textAlign: "right" })}
          />
        </div>
        <div className="tiptap-content-wrapper min-h-[200px] max-h-[400px] overflow-y-auto bg-white">
          <EditorContent editor={editor} />
        </div>
      </div>

      <StackedDrawer id={LINK_MODAL_ID}>
        <StackedDrawer.Content>
          <StackedDrawer.Header>
            <StackedDrawer.Title>Insert Link</StackedDrawer.Title>
          </StackedDrawer.Header>
          <StackedDrawer.Body className="space-y-4">
            <div>
              <Label>URL</Label>
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
              />
            </div>
            <div className="flex items-center gap-x-2">
              <Checkbox
                checked={linkOpenNewTab}
                onCheckedChange={(v) => setLinkOpenNewTab(v === true)}
              />
              <Label className="cursor-pointer" onClick={() => setLinkOpenNewTab((p) => !p)}>
                Open in new tab
              </Label>
            </div>
          </StackedDrawer.Body>
          <StackedDrawer.Footer>
            <Button variant="secondary" onClick={() => setStackedOpen(LINK_MODAL_ID, false)}>
              Cancel
            </Button>
            <Button onClick={confirmSetLink}>
              {linkUrl.trim() ? "Apply" : "Remove link"}
            </Button>
          </StackedDrawer.Footer>
        </StackedDrawer.Content>
      </StackedDrawer>

      <StackedDrawer id={IMAGE_MODAL_ID}>
        <StackedDrawer.Content>
          <StackedDrawer.Header>
            <StackedDrawer.Title>Insert Image</StackedDrawer.Title>
          </StackedDrawer.Header>
          <StackedDrawer.Body className="space-y-4">
            <div>
              <Label>Image URL</Label>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
              />
            </div>
            {(() => {
              const safe = sanitizeUrl(imageUrl)
              return safe ? (
                <div className="rounded-md border border-ui-border-base overflow-hidden max-h-40">
                  <img
                    src={safe}
                    alt="Preview"
                    className="w-full h-auto object-contain"
                  />
                </div>
              ) : null
            })()}
          </StackedDrawer.Body>
          <StackedDrawer.Footer>
            <Button variant="secondary" onClick={() => setStackedOpen(IMAGE_MODAL_ID, false)}>
              Cancel
            </Button>
            <Button onClick={confirmAddImage} disabled={!sanitizeUrl(imageUrl)}>
              Insert
            </Button>
          </StackedDrawer.Footer>
        </StackedDrawer.Content>
      </StackedDrawer>
    </>
  )
}
