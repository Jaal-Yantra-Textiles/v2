import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import { Embed, VideoFile } from "./embed-extension"
import { useCallback, useState, useRef, useEffect } from "react"
import { Button, Input, Label, Checkbox, Text } from "@medusajs/ui"
import { StackedDrawer } from "../modals/stacked-drawer"
import { useStackedModal } from "../modals/stacked-modal-provider"
import { usePartnerUpload } from "../../hooks/api/uploads"

type TipTapEditorProps = {
  content?: Record<string, unknown>
  onChange?: (json: Record<string, unknown>) => void
  placeholder?: string
  onEditorReady?: (editor: Editor, actions: TipTapActions) => void
}

export type TipTapActions = {
  setLink: () => void
  addImage: () => void
  addVideo: () => void
  triggerUpload: () => void
}

export const TipTapEditor = ({
  content,
  onChange,
  placeholder = "Start writing...",
  onEditorReady,
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
      Embed,
      VideoFile,
    ],
    content: content || { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON() as Record<string, unknown>)
    },
  })

  const [linkUrl, setLinkUrl] = useState("")
  const [linkOpenNewTab, setLinkOpenNewTab] = useState(false)
  const [imageUrl, setImageUrl] = useState("")
  const [videoUrl, setVideoUrl] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { setIsOpen: setStackedOpen } = useStackedModal()
  const { mutateAsync: uploadFiles } = usePartnerUpload()
  const LINK_MODAL_ID = "tiptap-link"
  const IMAGE_MODAL_ID = "tiptap-image"
  const VIDEO_MODAL_ID = "tiptap-video"


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

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadError(null)
    setIsUploading(true)
    try {
      const result = await uploadFiles(Array.from(files))
      const uploadedUrl = result?.files?.[0]?.url
      if (uploadedUrl && editor) {
        editor.chain().focus().setImage({ src: uploadedUrl }).run()
      }
      setStackedOpen(IMAGE_MODAL_ID, false)
    } catch (e) {
      // Surface the failure in the image modal rather than closing it — the
      // upload can be triggered without the modal ever being open, so open it.
      setUploadError(
        e instanceof Error ? e.message : "Upload failed. Please try again."
      )
      setStackedOpen(IMAGE_MODAL_ID, true)
    } finally {
      setIsUploading(false)
    }
  }, [editor, uploadFiles, setStackedOpen])

  const addVideo = useCallback(() => {
    if (!editor) return
    setVideoUrl("")
    setStackedOpen(VIDEO_MODAL_ID, true)
  }, [editor])

  // `type` must be a node name registered above (`embed` or `video`), not a
  // provider name — ProseMirror rejects a node type absent from the schema.
  const parseVideoUrl = useCallback((url: string): { src: string; type: string } | null => {
    const trimmed = url.trim()
    if (!trimmed) return null
    try {
      const parsed = new URL(trimmed)
      const host = parsed.hostname.replace("www.", "")
      if (host === "youtube.com" || host === "youtu.be") {
        const videoId = host === "youtu.be"
          ? parsed.pathname.slice(1)
          : parsed.searchParams.get("v") || parsed.pathname.split("/").pop()
        if (videoId) {
          return { src: `https://www.youtube.com/embed/${videoId}`, type: "embed" }
        }
      }
      if (host === "vimeo.com") {
        const videoId = parsed.pathname.split("/").pop()
        if (videoId) {
          return { src: `https://player.vimeo.com/video/${videoId}`, type: "embed" }
        }
      }
      if (host === "player.vimeo.com") {
        return { src: trimmed, type: "embed" }
      }
      if (trimmed.match(/\.(mp4|webm|ogg)$/)) {
        return { src: trimmed, type: "video" }
      }
      return { src: trimmed, type: "embed" }
    } catch {
      return null
    }
  }, [])

  const confirmAddVideo = useCallback(() => {
    const parsed = parseVideoUrl(videoUrl)
    setStackedOpen(VIDEO_MODAL_ID, false)
    if (parsed && editor) {
      editor.chain().focus().insertContent({
        type: parsed.type,
        attrs: { src: parsed.src },
      }).run()
    }
  }, [editor, videoUrl, parseVideoUrl, setStackedOpen])

  useEffect(() => {
    if (editor && onEditorReady) {
      const actions: TipTapActions = {
        setLink: () => {
          const prev = editor.getAttributes("link").href || ""
          setLinkUrl(prev)
          setLinkOpenNewTab(editor.getAttributes("link").target === "_blank")
          setStackedOpen(LINK_MODAL_ID, true)
        },
        addImage: () => {
          setImageUrl("")
          setStackedOpen(IMAGE_MODAL_ID, true)
        },
        addVideo: () => {
          setVideoUrl("")
          setStackedOpen(VIDEO_MODAL_ID, true)
        },
        triggerUpload: () => {
          fileInputRef.current?.click()
        },
      }
      onEditorReady(editor, actions)
      // On unmount the editor is destroyed, but the parent still holds this
      // instance in a ref. Hand back null so the floating toolbar stops
      // dispatching commands into a dead editor (it silently no-ops otherwise).
      return () => onEditorReady(null as unknown as Editor, actions)
    }
  }, [editor, onEditorReady])

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
            label={isUploading ? "Uploading…" : "Upload"}
            onClick={() => {
              if (!isUploading) fileInputRef.current?.click()
            }}
          />
          <ToolbarButton label="Video" onClick={addVideo} />
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
            {isUploading ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                Uploading…
              </Text>
            ) : null}
            {uploadError ? (
              <Text size="xsmall" className="text-ui-fg-error">
                {uploadError}
              </Text>
            ) : null}
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={false}
        style={{ display: "none" }}
        onChange={(e) => {
          const { files } = e.target
          // Clear the value so picking the SAME file again still fires onChange.
          e.target.value = ""
          handleFileUpload(files)
        }}
      />

      <StackedDrawer id={VIDEO_MODAL_ID}>
        <StackedDrawer.Content>
          <StackedDrawer.Header>
            <StackedDrawer.Title>Insert Video</StackedDrawer.Title>
          </StackedDrawer.Header>
          <StackedDrawer.Body className="space-y-4">
            <div>
              <Label>Video URL (YouTube, Vimeo, or MP4)</Label>
              <Input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                autoFocus
              />
            </div>
            <Text size="xsmall" className="text-ui-fg-muted">
              Paste a YouTube or Vimeo link, or a direct video file URL (MP4, WebM, OGG).
            </Text>
            {parseVideoUrl(videoUrl) && (
              <div className="rounded-md border border-ui-border-base overflow-hidden max-h-40">
                {parseVideoUrl(videoUrl)?.type === "video" ? (
                  <video controls className="w-full h-auto">
                    <source src={parseVideoUrl(videoUrl)?.src} />
                  </video>
                ) : (
                  <div style={{ paddingBottom: "56.25%", position: "relative", height: 0 }}>
                    <iframe
                      src={parseVideoUrl(videoUrl)?.src}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                )}
              </div>
            )}
          </StackedDrawer.Body>
          <StackedDrawer.Footer>
            <Button variant="secondary" onClick={() => setStackedOpen(VIDEO_MODAL_ID, false)}>
              Cancel
            </Button>
            <Button onClick={confirmAddVideo} disabled={!parseVideoUrl(videoUrl)}>
              Insert Video
            </Button>
          </StackedDrawer.Footer>
        </StackedDrawer.Content>
      </StackedDrawer>
    </>
  )
}
