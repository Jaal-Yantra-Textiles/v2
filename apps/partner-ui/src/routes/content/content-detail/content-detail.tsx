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
  Drawer,
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
} from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { BlockEditor } from "../../../components/block-editor/block-editor"
import {
  useContentPage,
  useContentBlocks,
  useUpdateContentPage,
  useDeleteContentPage,
  useCreateContentBlock,
  useDeleteContentBlock,
  ContentBlock,
} from "../../../hooks/api/content"
import { useStorefrontStatus } from "../../../hooks/api/storefront"
import { sdk } from "../../../lib/client"
import { FetchError } from "@medusajs/js-sdk"

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

  const { page, isPending: pageLoading } = useContentPage(pageId!)
  const { blocks: initialBlocks, isPending: blocksLoading } = useContentBlocks(pageId!)
  const { data: storefrontStatus } = useStorefrontStatus()
  const { mutateAsync: updatePage, isPending: isUpdatingPage } = useUpdateContentPage(pageId!)
  const { mutateAsync: deletePage } = useDeleteContentPage(pageId!)
  const { mutateAsync: createBlock, isPending: isCreatingBlock } = useCreateContentBlock(pageId!)
  const { mutateAsync: deleteBlock } = useDeleteContentBlock(pageId!)

  const [blocks, setBlocks] = useState<ContentBlock[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved")
  const [iframeReady, setIframeReady] = useState(false)
  const [addBlockOpen, setAddBlockOpen] = useState(false)
  const [newBlockType, setNewBlockType] = useState<string>("MainContent")
  const [newBlockName, setNewBlockName] = useState("")

  const domain = storefrontStatus?.domain

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
        const { blockId, field, value } = data
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === blockId
              ? { ...b, content: { ...b.content, [field]: value } }
              : b
          )
        )
        setSaveStatus("saving")
        sdk.client
          .fetch(
            `/partners/storefront/pages/${pageId}/blocks/${blockId}`,
            {
              method: "PUT",
              body: { content: { [field]: value } },
            }
          )
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
        Promise.all(
          orderedIds.map((blockId, idx) =>
            sdk.client.fetch(
              `/partners/storefront/pages/${pageId}/blocks/${blockId}`,
              { method: "PUT", body: { order: idx } }
            )
          )
        )
          .then(() => setSaveStatus("saved"))
          .catch(() => setSaveStatus("unsaved"))
        if (iframeRef.current) {
          setTimeout(() => {
            if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
          }, 300)
        }
      }
      if (data.type === "REQUEST_ADD_BLOCK_AT") {
        setAddBlockOpen(true)
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
        await sdk.client.fetch(
          `/partners/storefront/pages/${pageId}/blocks/${blockId}`,
          { method: "PUT", body: updates }
        )
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
      setAddBlockOpen(false)
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
  const previewUrl = domain
    ? `https://${domain}/${countryCode}/pages/${page?.slug || ""}?visual_editor=true`
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
                  setAddBlockOpen(true)
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
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          </div>

          {/* Property panel */}
          {selectedBlock ? (
            <BlockEditor
              block={selectedBlock}
              onUpdate={handleBlockUpdate}
              onDelete={handleDeleteBlock}
              saveStatus={saveStatus}
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
      <Drawer open={addBlockOpen} onOpenChange={setAddBlockOpen}>
        <Drawer.Header>
          <Drawer.Title>Add New Block</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="space-y-4">
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
            </Text>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={() => setAddBlockOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAddBlock} disabled={isCreatingBlock}>
            <Plus className="mr-1.5" />Add Block
          </Button>
        </Drawer.Footer>
      </Drawer>
    </>
  )
}
