import { useState, useCallback, useRef, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  Heading,
  Text,
  Button,
  Badge,
  toast,
  Tooltip,
  IconButton,
  Select,
  Label,
  Input,
} from "@medusajs/ui"
import {
  ArrowPath,
  CursorArrowRays,
  EyeMini,
  EyeSlash,
  Trash,
  Plus,
} from "@medusajs/icons"
import {
  RouteFocusModal,
  useRouteModal,
  useStackedModal,
} from "../../../components/modals"
import { StackedDrawer } from "../../../components/modals/stacked-drawer"
import { Skeleton } from "../../../components/common/skeleton"
import { BlockEditor } from "../../../components/block-editor/block-editor"

const UNSAFE_PROPS = new Set(["__proto__", "constructor", "prototype"])

function isSafeFieldPart(part: string): boolean {
  return !UNSAFE_PROPS.has(part)
}

function setNestedValue(
  content: Record<string, unknown>,
  field: string,
  value: unknown
): Record<string, unknown> {
  const contentCopy: Record<string, unknown> = JSON.parse(
    JSON.stringify(content || {})
  )
  const parts = field.split(".")
  if (!parts.every(isSafeFieldPart)) {
    return contentCopy
  }
  let obj: Record<string, unknown> = contentCopy
  for (let i = 0; i < parts.length - 1; i++) {
    const idx = parseInt(parts[i], 10)
    if (!isNaN(idx)) {
      if (!obj[parts[i]]) {
        obj[parts[i]] = []
      }
      obj = obj[parts[i]] as Record<string, unknown>
    } else {
      if (!obj[parts[i]]) {
        obj[parts[i]] = {}
      }
      obj = obj[parts[i]] as Record<string, unknown>
    }
  }
  obj[parts[parts.length - 1]] = value
  return contentCopy
}
import { TipTapEditor } from "../../../components/tiptap-editor/tiptap-editor"
import {
  useContentPage,
  useContentBlocks,
  useUpdateContentPage,
  useDeleteContentPage,
  useCreateContentBlock,
  useUpdateContentBlock,
  useReorderBlocks,
  useDeleteContentBlock,
  ContentBlock,
} from "../../../hooks/api/content"
import { useStorefrontStatus } from "../../../hooks/api/storefront"
import { FetchError } from "@medusajs/js-sdk"
import { usePartnerUpload } from "../../../hooks/api/uploads"

const BLOCK_TYPES = [
  "Hero",
  "MainContent",
  "Section",
  "Gallery",
  "Feature",
  "Testimonial",
  "Product",
  "ContactForm",
  "Header",
  "Footer",
  "Custom",
  "HeroWithImage",
  "BentoGrid",
  "Button",
] as const

const UNIQUE_BLOCK_TYPES = new Set([
  "Hero",
  "Header",
  "Footer",
  "MainContent",
  "ContactForm",
])

const DEFAULT_CONTENT_FOR_TYPE: Record<string, Record<string, unknown>> = {
  Hero: { title: "New Hero", subtitle: "", align: "center" },
  MainContent: { title: "", body: { type: "doc", content: [{ type: "paragraph" }] } },
  Section: { title: "New Section", body: { type: "doc", content: [{ type: "paragraph" }] } },
  Gallery: { images: [] },
  Feature: { title: "New Feature", description: "" },
  Testimonial: { quote: "", author: "" },
  Product: { title: "Featured Product" },
  ContactForm: { title: "Contact Us" },
  Header: { links: [] },
  Footer: { text: "" },
  Custom: { title: "Custom Block", body: { type: "doc", content: [{ type: "paragraph" }] } },
  HeroWithImage: {
    eyebrow: "",
    title: "New Hero with Image",
    subtitle: "",
    layout: "image-right",
    image_url: "",
    image_alt: "",
    buttons: [{ label: "Shop Now", href: "#", variant: "primary" }],
  },
  BentoGrid: {
    title: "Bento Grid",
    subtitle: "",
    columns: "3",
    cards: [
      { eyebrow: "", title: "Card 1", description: "Description here", col_span: "1", row_span: "1" },
      { eyebrow: "", title: "Card 2", description: "Description here", col_span: "1", row_span: "1" },
      { eyebrow: "", title: "Card 3", description: "Description here", col_span: "1", row_span: "1" },
    ],
  },
  Button: {
    align: "left",
    buttons: [{ label: "Click Me", href: "#", variant: "primary", size: "medium" }],
  },
}

export const ContentDetail = () => {
  return (
    <RouteFocusModal>
      <ContentDetailInner />
    </RouteFocusModal>
  )
}

const ContentDetailInner = () => {
  const { id: pageId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { handleSuccess } = useRouteModal()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const toolbarFileInputRef = useRef<HTMLInputElement>(null)
  const toolbarUploadBlockIdRef = useRef<string | null>(null)
  const tiptapEditorRef = useRef<any>(null)
  const tiptapActionsRef = useRef<any>(null)
  const { mutateAsync: uploadFile } = usePartnerUpload()

  const handleEditorReady = useCallback((editor: any, actions: any) => {
    tiptapEditorRef.current = editor
    tiptapActionsRef.current = actions
  }, [])

  const { page, isPending: pageLoading } = useContentPage(pageId!)
  const { blocks: initialBlocks, isPending: blocksLoading } = useContentBlocks(pageId!)
  const { data: storefrontStatus } = useStorefrontStatus()
  const { mutateAsync: updatePage, isPending: isUpdatingPage } = useUpdateContentPage(pageId!)
  const { mutateAsync: deletePage } = useDeleteContentPage(pageId!)
  const { mutateAsync: createBlock, isPending: isCreatingBlock } = useCreateContentBlock(pageId!)
  const { mutateAsync: updateBlock } = useUpdateContentBlock(pageId!)
  const { mutateAsync: reorderBlocks } = useReorderBlocks(pageId!)
  const { mutateAsync: deleteBlock } = useDeleteContentBlock(pageId!)

  const [blocks, setBlocks] = useState<ContentBlock[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved")
  const [iframeReady, setIframeReady] = useState(false)
  const { setIsOpen: setStackedOpen } = useStackedModal()
  const ADD_BLOCK_ID = "add-block"
  const BODY_EDITOR_ID = "body-editor"
  const [newBlockType, setNewBlockType] = useState<string>("MainContent")
  const [newBlockName, setNewBlockName] = useState("")
  const [bodyEditorBlockId, setBodyEditorBlockId] = useState<string | null>(null)
  const [bodyEditorField, setBodyEditorField] = useState<string>("body")
  const [bodyEditorContent, setBodyEditorContent] = useState<Record<string, unknown> | null>(null)

  const storefrontUrl = storefrontStatus?.storefront_url

  useEffect(() => {
    if (initialBlocks?.length) {
      setBlocks([...initialBlocks].sort((a, b) => a.order - b.order))
    }
  }, [initialBlocks])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object" || !("type" in data)) return
      if (data.type === "VISUAL_EDITOR_READY") setIframeReady(true)
      if (data.type === "BLOCK_CLICKED") setSelectedBlockId(data.blockId)
      if (data.type === "BLOCK_PREVIEW_RELOAD_NEEDED" && iframeRef.current) {
        setTimeout(() => {
          if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
        }, 200)
      }
      if (data.type === "BLOCK_FIELD_EDITED") {
        const { blockId, field, value, isHtml } = data as any
        const isNested = field.includes(".")

        setBlocks((prev) =>
          prev.map((b) => {
            if (b.id !== blockId) return b
            if (isNested) {
              return { ...b, content: setNestedValue(b.content, field, value) }
            }
            return { ...b, content: { ...b.content, [field]: value } }
          })
        )
        setSaveStatus("saving")
        const contentUpdate = (() => {
          if (isNested) {
            const block = blocks.find((b) => b.id === blockId)
            if (!block) return {}
            return { content: setNestedValue(block.content, field, value) }
          }
          return { content: { [field]: value } }
        })()
        updateBlock({
          blockId,
          body: contentUpdate,
        })
          .then(() => setSaveStatus("saved"))
          .catch(() => setSaveStatus("unsaved"))
      }
      if (data.type === "BLOCK_REORDERED") {
        const { orderedIds } = data as { orderedIds: string[] }
        setBlocks((prev) => {
          const reordered = orderedIds
            .map((id) => prev.find((b) => b.id === id))
            .filter(Boolean) as ContentBlock[]
          return reordered.map((b, idx) => ({ ...b, order: idx }))
        })
        setSaveStatus("saving")
        reorderBlocks(orderedIds)
          .then(() => setSaveStatus("saved"))
          .catch(() => setSaveStatus("unsaved"))
        if (iframeRef.current) {
          setTimeout(() => {
            if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
          }, 300)
        }
      }
      if (data.type === "REQUEST_ADD_BLOCK_AT") {
        setStackedOpen(ADD_BLOCK_ID, true)
      }
      if (data.type === "OPEN_BODY_EDITOR") {
        const { blockId, field } = data as any
        const block = blocks.find((b) => b.id === blockId)
        if (!block) return
        setBodyEditorBlockId(blockId)
        setBodyEditorField(field)
        setBodyEditorContent((block.content[field] as Record<string, unknown>) || null)
        setStackedOpen(BODY_EDITOR_ID, true)
      }
      if (data.type === "REQUEST_IMAGE_UPLOAD") {
        toolbarUploadBlockIdRef.current = (data as any).blockId
        toolbarFileInputRef.current?.click()
      }
      if (data.type === "TOOLBAR_COMMAND") {
        const { command } = data as any
        const editor = tiptapEditorRef.current
        const actions = tiptapActionsRef.current
        if (!editor) return

        const cmdMap: Record<string, () => void> = {
          toggleBold: () => editor.chain().focus().toggleBold().run(),
          toggleItalic: () => editor.chain().focus().toggleItalic().run(),
          toggleUnderline: () => editor.chain().focus().toggleUnderline().run(),
          toggleHeading1: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          toggleHeading2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          toggleHeading3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
          toggleOrderedList: () => editor.chain().focus().toggleOrderedList().run(),
          toggleBlockquote: () => editor.chain().focus().toggleBlockquote().run(),
          toggleCodeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
          alignLeft: () => editor.chain().focus().setTextAlign("left").run(),
          alignCenter: () => editor.chain().focus().setTextAlign("center").run(),
          alignRight: () => editor.chain().focus().setTextAlign("right").run(),
          setLink: () => actions?.setLink(),
          addImage: () => actions?.addImage(),
          addVideo: () => actions?.addVideo(),
          triggerUpload: () => actions?.triggerUpload(),
        }
        const fn = Object.prototype.hasOwnProperty.call(cmdMap, command)
          ? cmdMap[command]
          : undefined
        if (fn) fn()
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [pageId])

  useEffect(() => {
    if (iframeReady && selectedBlockId && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "SELECT_BLOCK", blockId: selectedBlockId },
        "*"
      )
      iframeRef.current.contentWindow.postMessage(
        { type: "ENABLE_INLINE_EDITING", blockId: selectedBlockId },
        "*"
      )
    }
    if (iframeReady && !selectedBlockId && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "DISABLE_INLINE_EDITING" },
        "*"
      )
    }
  }, [iframeReady, selectedBlockId])

  const handleBlockUpdate = useCallback(
    async (blockId: string, updates: Partial<ContentBlock>) => {
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, ...updates } : b))
      )
      setSaveStatus("saving")

      if (iframeReady && iframeRef.current?.contentWindow && (updates.content || updates.settings)) {
        const current = blocks.find((b) => b.id === blockId)
        iframeRef.current.contentWindow.postMessage(
          {
            type: "UPDATE_BLOCK_PREVIEW",
            blockId,
            content: { ...(current?.content || {}), ...(updates.content || {}) },
            settings: { ...(current?.settings || {}), ...(updates.settings || {}) },
          },
          "*"
        )
      }

      try {
        await updateBlock({ blockId, body: updates })
        setSaveStatus("saved")
      } catch {
        setSaveStatus("unsaved")
        toast.error("Failed to save changes")
      }
    },
    [pageId, iframeReady, blocks]
  )

  const handleDeleteBlock = useCallback(
    async (blockId: string) => {
      const block = blocks.find((b) => b.id === blockId)
      setBlocks((prev) => prev.filter((b) => b.id !== blockId))
      if (selectedBlockId === blockId) setSelectedBlockId(null)
      try {
        await deleteBlock(blockId)
        toast.success(`Deleted "${block?.name || "block"}"`)
      } catch {
        toast.error("Failed to delete block")
        if (initialBlocks) setBlocks([...initialBlocks].sort((a, b) => a.order - b.order))
      }
    },
    [blocks, selectedBlockId, deleteBlock, initialBlocks]
  )

  const usedUniqueTypes = new Set(
    blocks
      .filter((b) => UNIQUE_BLOCK_TYPES.has(b.type))
      .map((b) => b.type)
  )

  const handleAddBlock = useCallback(async () => {
    const name = newBlockName.trim() || newBlockType
    const maxOrder = blocks.reduce((max, b) => Math.max(max, b.order), -1)
    try {
      const result = await createBlock({
        name,
        type: newBlockType,
        content: DEFAULT_CONTENT_FOR_TYPE[newBlockType] || {},
        order: maxOrder + 1,
        status: "Active",
      })
      const newBlock = result?.blocks?.[0]
      if (newBlock) {
        setBlocks((prev) => [...prev, newBlock])
        setSelectedBlockId(newBlock.id)
      }
      setStackedOpen(ADD_BLOCK_ID, false)
      setNewBlockName("")
      toast.success(`Added "${name}" block`)
      if (iframeRef.current) {
        setTimeout(() => {
          if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
        }, 300)
      }
    } catch (err: unknown) {
      let msg = "Failed to add block"
      if (err instanceof FetchError) {
        try {
          const body = (err as any).json ?? await err.json?.().catch(() => null)
          const firstError = body?.errors?.[0]?.error
          if (firstError && typeof firstError === "string") {
            if (firstError.includes("unique") || firstError.includes("already exists")) {
              msg = `A ${newBlockType} block already exists on this page. Only one ${newBlockType} is allowed per page.`
            } else {
              msg = firstError
            }
          } else if (typeof (err as any).message === "string" && (err as any).message.includes("unique")) {
            msg = `A ${newBlockType} block already exists on this page. Only one ${newBlockType} is allowed per page.`
          }
        } catch {}
      } else if (err instanceof Error && err.message) {
        msg = err.message
      }
      toast.error(msg)
    }
  }, [newBlockName, newBlockType, blocks, createBlock])

  const handleToggleStatus = async () => {
    if (!page) return
    const newStatus = page.status === "Published" ? "Draft" : "Published"
    try {
      await updatePage({
        status: newStatus,
        ...(newStatus === "Published" ? { published_at: new Date().toISOString() } : {}),
      })
      toast.success(`Page ${newStatus === "Published" ? "published" : "unpublished"}`)
    } catch (e: any) {
      toast.error(e?.message || "Failed to update status")
    }
  }

  const handleDelete = async () => {
    try {
      await deletePage()
      toast.success("Page deleted")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete page")
    }
  }

  const handleRefresh = () => {
    if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
  }

  const countryCode = "in"
  const previewUrl = storefrontUrl
    ? `${storefrontUrl}/${countryCode}/pages/${page?.slug || ""}?visual_editor=true`
    : `http://localhost:8000/${countryCode}/pages/${page?.slug || ""}?visual_editor=true`

  const isPublished = page?.status === "Published"
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId)

  if (pageLoading || blocksLoading) {
    return (
      <>
        <RouteFocusModal.Header>
          <div className="flex items-center gap-x-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
          <div className="flex h-full overflow-hidden">
            <div className="w-[240px] border-r border-ui-border-base bg-ui-bg-subtle p-3 space-y-2">
              <Skeleton className="h-4 w-16 mb-3" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-md" />
              ))}
            </div>
            <div className="flex-1 bg-ui-bg-subtle p-4">
              <Skeleton className="w-full h-full rounded-lg" />
            </div>
            <div className="w-[340px] border-l border-ui-border-base p-4 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </RouteFocusModal.Body>
      </>
    )
  }

  if (!page) {
    return (
      <>
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <Heading>Page not found</Heading>
          </RouteFocusModal.Title>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex items-center justify-center">
          <Text className="text-ui-fg-subtle">This page does not exist.</Text>
        </RouteFocusModal.Body>
      </>
    )
  }

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-3">
          <RouteFocusModal.Title asChild>
            <Heading>{page.title}</Heading>
          </RouteFocusModal.Title>
          <Badge color={isPublished ? "green" : "orange"} size="2xsmall">
            {page.status}
          </Badge>
          <Badge color="grey" size="2xsmall">/{page.slug}</Badge>
        </div>
        <div className="flex items-center gap-x-2">
          <Tooltip content="Refresh preview">
            <IconButton variant="transparent" size="small" onClick={handleRefresh}>
              <ArrowPath />
            </IconButton>
          </Tooltip>
          <Button
            variant={isPublished ? "secondary" : "primary"}
            size="small"
            onClick={handleToggleStatus}
            disabled={isUpdatingPage}
          >
            {isPublished ? (
              <><EyeSlash className="mr-1.5" />Unpublish</>
            ) : (
              <><EyeMini className="mr-1.5" />Publish</>
            )}
          </Button>
          <Button variant="secondary" size="small" onClick={handleDelete}>
            <Trash className="mr-1.5" />Delete
          </Button>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
        <div className="flex h-full overflow-hidden">
          {/* Block list sidebar */}
          <div className="w-[240px] border-r border-ui-border-base overflow-y-auto bg-ui-bg-subtle shrink-0 flex flex-col">
            <div className="px-3 py-3 flex items-center justify-between">
              <Text size="xsmall" className="text-ui-fg-muted uppercase font-semibold tracking-wide">
                Blocks ({blocks.length})
              </Text>
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  const available = BLOCK_TYPES.find(
                    (t) => !usedUniqueTypes.has(t)
                  )
                  if (available) setNewBlockType(available)
                  setStackedOpen(ADD_BLOCK_ID, true)
                }}
              >
                <Plus className="mr-1" />Add
              </Button>
            </div>
            <div className="flex flex-col gap-y-0.5 px-2 pb-3 flex-1">
              {blocks.map((block) => (
                <button
                  key={block.id}
                  onClick={() => setSelectedBlockId(block.id)}
                  className={`flex items-center gap-x-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                    selectedBlockId === block.id
                      ? "bg-ui-bg-highlight border border-ui-border-strong"
                      : "hover:bg-ui-bg-base border border-transparent"
                  }`}
                >
                  <Badge
                    color={
                      block.status === "Active" ? "green" : block.status === "Draft" ? "orange" : "grey"
                    }
                    size="2xsmall"
                  >
                    {block.type}
                  </Badge>
                  <Text size="small" className="truncate flex-1">{block.name}</Text>
                </button>
              ))}
              {blocks.length === 0 && (
                <div className="text-center py-8 px-4">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    No blocks yet. Click "Add" to create your first block.
                  </Text>
                </div>
              )}
            </div>
          </div>

          {/* Preview iframe */}
          <div className="flex-1 bg-ui-bg-subtle p-4">
            <div className="w-full h-full rounded-lg shadow-elevation-card-rest overflow-hidden bg-white">
              <iframe
                ref={iframeRef}
                src={previewUrl}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
              />
            </div>
            <input
              ref={toolbarFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file || !toolbarUploadBlockIdRef.current) return
                try {
                  const result = await uploadFile(file)
                  const imageUrl = result.url || result.id
                  if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage(
                      { type: "INSERT_IMAGE_AT_CURSOR", imageUrl },
                      "*"
                    )
                  }
                  toast.success("Image uploaded")
                } catch {
                  toast.error("Upload failed")
                }
                if (toolbarFileInputRef.current) toolbarFileInputRef.current.value = ""
              }}
            />
          </div>

          {/* Property panel */}
          {selectedBlock ? (
            <BlockEditor
              block={selectedBlock}
              onUpdate={handleBlockUpdate}
              onDelete={handleDeleteBlock}
              onDuplicate={async (blockId) => {
                const block = blocks.find((b) => b.id === blockId)
                if (!block) return
                const maxOrder = blocks.reduce((max, b) => Math.max(max, b.order), -1)
                try {
                  const result = await createBlock({
                    name: `${block.name} (copy)`,
                    type: block.type,
                    content: { ...block.content },
                    settings: block.settings,
                    order: maxOrder + 1,
                    status: "Active",
                  })
                  const newBlock = result?.blocks?.[0]
                  if (newBlock) setBlocks((prev) => [...prev, newBlock])
                  toast.success(`Duplicated "${block.name}"`)
                  if (iframeRef.current) {
                    setTimeout(() => {
                      if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
                    }, 300)
                  }
                } catch {
                  toast.error("Failed to duplicate block")
                }
              }}
              onMoveUp={(blockId) => {
                const idx = blocks.findIndex((b) => b.id === blockId)
                if (idx <= 0) return
                const reordered = [...blocks]
                ;[reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]]
                const orderedIds = reordered.map((b) => b.id)
                setBlocks(reordered.map((b, i) => ({ ...b, order: i })))
                reorderBlocks(orderedIds)
                if (iframeRef.current) {
                  setTimeout(() => {
                    if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
                  }, 300)
                }
              }}
              onMoveDown={(blockId) => {
                const idx = blocks.findIndex((b) => b.id === blockId)
                if (idx < 0 || idx >= blocks.length - 1) return
                const reordered = [...blocks]
                ;[reordered[idx + 1], reordered[idx]] = [reordered[idx], reordered[idx + 1]]
                const orderedIds = reordered.map((b) => b.id)
                setBlocks(reordered.map((b, i) => ({ ...b, order: i })))
                reorderBlocks(orderedIds)
                if (iframeRef.current) {
                  setTimeout(() => {
                    if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
                  }, 300)
                }
              }}
              canMoveUp={blocks.findIndex((b) => b.id === selectedBlock.id) > 0}
              canMoveDown={blocks.findIndex((b) => b.id === selectedBlock.id) < blocks.length - 1}
              saveStatus={saveStatus}
              onEditorReady={handleEditorReady}
            />
          ) : (
            <div className="w-[340px] border-l border-ui-border-base flex flex-col items-center justify-center p-6 text-center shrink-0">
              <CursorArrowRays className="text-ui-fg-muted opacity-40 mb-3" />
              <Text size="small" className="text-ui-fg-subtle">
                Click a block to edit its content
              </Text>
              <Text size="xsmall" className="text-ui-fg-muted mt-2">
                Use the TipTap editor for rich text, add images, and more
              </Text>
            </div>
          )}
        </div>
      </RouteFocusModal.Body>

      {/* Add Block Drawer */}
      <StackedDrawer id={ADD_BLOCK_ID}>
        <StackedDrawer.Content>
        <StackedDrawer.Header>
          <StackedDrawer.Title>Add New Block</StackedDrawer.Title>
        </StackedDrawer.Header>
        <StackedDrawer.Body className="space-y-4">
          <div>
            <Label>Block Type</Label>
            <Select value={newBlockType} onValueChange={setNewBlockType}>
              <Select.Trigger>
                <Select.Value placeholder="Select block type" />
              </Select.Trigger>
              <Select.Content>
                {BLOCK_TYPES.map((t) => {
                  const alreadyUsed = usedUniqueTypes.has(t)
                  return (
                    <Select.Item
                      key={t}
                      value={t}
                      disabled={alreadyUsed}
                    >
                      {t}
                      {alreadyUsed && " (already added)"}
                    </Select.Item>
                  )
                })}
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label>Block Name</Label>
            <Input
              value={newBlockName}
              onChange={(e) => setNewBlockName(e.target.value)}
              placeholder={`My ${newBlockType}`}
            />
          </div>
          {UNIQUE_BLOCK_TYPES.has(newBlockType) && (
            <div className="rounded-md bg-ui-bg-info p-3 border border-ui-border-base">
              <Text size="xsmall" className="text-ui-fg-subtle">
                <strong>{newBlockType}</strong> is a unique block type — only one
                is allowed per page. Types like Feature, Gallery, Testimonial,
                Product, Section, and Custom can be added multiple times.
              </Text>
            </div>
          )}
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              {newBlockType === "MainContent" && "Rich text content block with TipTap editor — perfect for page body text, headings, lists, and images."}
              {newBlockType === "Hero" && "Large banner section with title, subtitle, background image, and call-to-action."}
              {newBlockType === "Section" && "Content section with rich text body, optional image, and layout options."}
              {newBlockType === "Gallery" && "Image gallery grid — add multiple images with alt text."}
              {newBlockType === "Feature" && "Feature card with title, description, and icon/image."}
              {newBlockType === "Testimonial" && "Customer testimonial with quote, author, and avatar."}
              {newBlockType === "Product" && "Featured product showcase with image and link."}
              {newBlockType === "ContactForm" && "Contact form section with title and description."}
              {newBlockType === "Header" && "Page header with navigation links."}
              {newBlockType === "Footer" && "Page footer with text and links."}
              {newBlockType === "Custom" && "Custom block with full rich text editor."}
              {newBlockType === "HeroWithImage" && "Hero section with title, subtitle, side image, and CTA buttons. Choose left/right image layout."}
              {newBlockType === "BentoGrid" && "Bento grid layout with cards of varying sizes. Each card has eyebrow, title, description, and optional image with col/row span controls."}
              {newBlockType === "Button" && "Standalone CTA button row. Add multiple buttons with labels, links, variants, and sizes."}
            </Text>
          </div>
        </StackedDrawer.Body>
        <StackedDrawer.Footer>
          <Button variant="secondary" onClick={() => setStackedOpen(ADD_BLOCK_ID, false)}>
            Cancel
          </Button>
          <Button onClick={handleAddBlock} disabled={isCreatingBlock}>
            <Plus className="mr-1.5" />Add Block
          </Button>
        </StackedDrawer.Footer>
        </StackedDrawer.Content>
      </StackedDrawer>

      {/* Body Editor Drawer */}
      <StackedDrawer id={BODY_EDITOR_ID}>
        <StackedDrawer.Content>
          <StackedDrawer.Header>
            <StackedDrawer.Title>Rich Text Editor</StackedDrawer.Title>
          </StackedDrawer.Header>
          <StackedDrawer.Body>
            {bodyEditorBlockId && (
              <TipTapEditor
                key={bodyEditorBlockId + "-" + bodyEditorField}
                content={bodyEditorContent || undefined}
                onChange={(json) => setBodyEditorContent(json)}
                placeholder="Start writing..."
                onEditorReady={handleEditorReady}
              />
            )}
          </StackedDrawer.Body>
          <StackedDrawer.Footer>
            <Button
              variant="secondary"
              onClick={() => setStackedOpen(BODY_EDITOR_ID, false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!bodyEditorBlockId) return
                setBlocks((prev) =>
                  prev.map((b) =>
                    b.id === bodyEditorBlockId
                      ? { ...b, content: { ...b.content, [bodyEditorField]: bodyEditorContent } }
                      : b
                  )
                )
                setSaveStatus("saving")
                updateBlock({
                  blockId: bodyEditorBlockId,
                  body: { content: { [bodyEditorField]: bodyEditorContent } },
                })
                  .then(() => {
                    setSaveStatus("saved")
                    setStackedOpen(BODY_EDITOR_ID, false)
                    if (iframeRef.current) {
                      setTimeout(() => {
                        if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
                      }, 300)
                    }
                  })
                  .catch(() => setSaveStatus("unsaved"))
              }}
            >
              Save & Close
            </Button>
          </StackedDrawer.Footer>
        </StackedDrawer.Content>
      </StackedDrawer>
    </>
  )
}
