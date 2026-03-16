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
} from "@medusajs/ui"
import {
  ArrowPath,
  CursorArrowRays,
  EyeMini,
  EyeSlash,
  Trash,
} from "@medusajs/icons"
import {
  RouteFocusModal,
  useRouteModal,
} from "../../../components/modals"
import {
  useContentPage,
  useContentBlocks,
  useUpdateContentPage,
  useDeleteContentPage,
  ContentBlock,
} from "../../../hooks/api/content"
import { useStorefrontStatus } from "../../../hooks/api/storefront"
import { sdk } from "../../../lib/client"

export const ContentDetail = () => {
  const { id: pageId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { handleSuccess } = useRouteModal()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const { page, isPending: pageLoading } = useContentPage(pageId!)
  const { blocks: initialBlocks, isPending: blocksLoading } = useContentBlocks(pageId!)
  const { data: storefrontStatus } = useStorefrontStatus()
  const { mutateAsync: updatePage, isPending: isUpdatingPage } = useUpdateContentPage(pageId!)
  const { mutateAsync: deletePage } = useDeleteContentPage(pageId!)

  const [blocks, setBlocks] = useState<ContentBlock[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved")
  const [iframeReady, setIframeReady] = useState(false)

  const domain = storefrontStatus?.domain

  useEffect(() => {
    if (initialBlocks?.length) {
      setBlocks([...initialBlocks].sort((a, b) => a.order - b.order))
    }
  }, [initialBlocks])

  // iframe communication
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object" || !("type" in data)) return
      if (data.type === "VISUAL_EDITOR_READY") setIframeReady(true)
      if (data.type === "BLOCK_CLICKED") setSelectedBlockId(data.blockId)
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  useEffect(() => {
    if (iframeReady && selectedBlockId && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "SELECT_BLOCK", blockId: selectedBlockId },
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

  const previewUrl = domain
    ? `https://${domain}/pages/${page?.slug || ""}?visual_editor=true`
    : `http://localhost:8000/pages/${page?.slug || ""}?visual_editor=true`

  const isPublished = page?.status === "Published"
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId)

  if (pageLoading || blocksLoading) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <Heading>Loading...</Heading>
          </RouteFocusModal.Title>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex items-center justify-center">
          <Text className="text-ui-fg-subtle">Loading page editor...</Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  if (!page) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <Heading>Page not found</Heading>
          </RouteFocusModal.Title>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex items-center justify-center">
          <Text className="text-ui-fg-subtle">This page does not exist.</Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  return (
    <RouteFocusModal>
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
          <div className="w-[220px] border-r border-ui-border-base overflow-y-auto bg-ui-bg-subtle shrink-0">
            <div className="px-3 py-3">
              <Text size="xsmall" className="text-ui-fg-muted uppercase font-semibold tracking-wide">
                Blocks ({blocks.length})
              </Text>
            </div>
            <div className="flex flex-col gap-y-0.5 px-2 pb-3">
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
                  <Badge color="grey" size="2xsmall">{block.type}</Badge>
                  <Text size="small" className="truncate">{block.name}</Text>
                </button>
              ))}
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
            <div className="w-[280px] border-l border-ui-border-base overflow-y-auto bg-ui-bg-base p-4 shrink-0">
              <div className="flex items-center justify-between mb-4">
                <Badge color="grey" size="small">{selectedBlock.type}</Badge>
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
              <div className="space-y-4">
                <div>
                  <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase mb-1">
                    Block Name
                  </Text>
                  <input
                    className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
                    value={selectedBlock.name}
                    onChange={(e) => handleBlockUpdate(selectedBlock.id, { name: e.target.value })}
                  />
                </div>

                {(selectedBlock.type === "Hero" || selectedBlock.type.toLowerCase().includes("hero")) && (
                  <>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase mb-1">Title</Text>
                      <input
                        className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
                        value={(selectedBlock.content?.title as string) || ""}
                        onChange={(e) =>
                          handleBlockUpdate(selectedBlock.id, {
                            content: { ...selectedBlock.content, title: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase mb-1">Subtitle</Text>
                      <textarea
                        className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm min-h-[60px]"
                        value={(selectedBlock.content?.subtitle as string) || ""}
                        onChange={(e) =>
                          handleBlockUpdate(selectedBlock.id, {
                            content: { ...selectedBlock.content, subtitle: e.target.value },
                          })
                        }
                      />
                    </div>
                  </>
                )}

                <div>
                  <Text size="xsmall" className="text-ui-fg-muted font-semibold uppercase mb-1">Background Color</Text>
                  <div className="flex gap-x-2">
                    <input
                      className="flex-1 rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm"
                      value={(selectedBlock.settings?.backgroundColor as string) || ""}
                      placeholder="#ffffff"
                      onChange={(e) =>
                        handleBlockUpdate(selectedBlock.id, {
                          settings: { ...selectedBlock.settings, backgroundColor: e.target.value },
                        })
                      }
                    />
                    <input
                      type="color"
                      value={(selectedBlock.settings?.backgroundColor as string) || "#ffffff"}
                      onChange={(e) =>
                        handleBlockUpdate(selectedBlock.id, {
                          settings: { ...selectedBlock.settings, backgroundColor: e.target.value },
                        })
                      }
                      className="w-9 h-9 rounded border border-ui-border-base cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-[280px] border-l border-ui-border-base flex flex-col items-center justify-center p-6 text-center shrink-0">
              <CursorArrowRays className="text-ui-fg-muted opacity-40 mb-3" />
              <Text size="small" className="text-ui-fg-subtle">
                Click a block to edit
              </Text>
            </div>
          )}
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}
