import { useState, useCallback, useRef, useEffect } from "react"
import { AdminBlock, useUpdateBlock, useCreateBlock, useDeleteBlock } from "../../hooks/api/blocks"
import { AdminPage } from "../../hooks/api/pages"
import { BlockListPanel } from "./panels/block-list-panel"
import { PreviewPanel } from "./panels/preview-panel"
import { PropertyEditorPanel } from "./panels/property-editor-panel"
import { useIframeCommunication } from "../../hooks/use-iframe-communication"
import { toast, Tooltip } from "@medusajs/ui"
import { SidebarLeft, SidebarRight, ArrowPath, CursorArrowRays } from "@medusajs/icons"
import "./visual-page-editor.css"

export interface VisualPageEditorProps {
  websiteId: string
  pageId: string
  page: AdminPage
  blocks: AdminBlock[]
}

export function VisualPageEditor({
  websiteId,
  pageId,
  page,
  blocks: initialBlocks,
}: VisualPageEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [blocks, setBlocks] = useState<AdminBlock[]>(
    [...initialBlocks].sort((a, b) => a.order - b.order)
  )
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved")
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId)

  // Get the preview URL for the page
  const previewUrl = getPreviewUrl(page.slug)

  // Iframe communication hook
  const {
    iframeReady,
    selectBlock: selectBlockInIframe,
    highlightBlock: highlightBlockInIframe,
  } = useIframeCommunication({
    iframeRef,
    onBlockClicked: (blockId) => setSelectedBlockId(blockId),
    onBlockHovered: (blockId) => setHoveredBlockId(blockId),
  })

  // Update blocks when initialBlocks changes
  useEffect(() => {
    setBlocks([...initialBlocks].sort((a, b) => a.order - b.order))
  }, [initialBlocks])

  // Sync selection to iframe
  useEffect(() => {
    if (iframeReady && selectedBlockId) {
      selectBlockInIframe(selectedBlockId)
    }
  }, [iframeReady, selectedBlockId, selectBlockInIframe])

  // Sync hover to iframe
  useEffect(() => {
    if (iframeReady) {
      highlightBlockInIframe(hoveredBlockId)
    }
  }, [iframeReady, hoveredBlockId, highlightBlockInIframe])

  // Handle block selection from list
  const handleBlockSelect = useCallback((blockId: string) => {
    setSelectedBlockId(blockId)
  }, [])

  // Handle block hover from list
  const handleBlockHover = useCallback((blockId: string | null) => {
    setHoveredBlockId(blockId)
  }, [])

  // Handle block reorder
  const handleBlockReorder = useCallback(
    async (reorderedBlocks: AdminBlock[]) => {
      setBlocks(reorderedBlocks)
      setSaveStatus("saving")

      try {
        // Update each block's order via API
        for (let i = 0; i < reorderedBlocks.length; i++) {
          const block = reorderedBlocks[i]
          if (block.order !== i) {
            await fetch(
              `/admin/websites/${websiteId}/pages/${pageId}/blocks/${block.id}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order: i }),
              }
            )
          }
        }
        setSaveStatus("saved")
        toast.success("Block order updated")
      } catch (error) {
        setSaveStatus("unsaved")
        toast.error("Failed to update block order")
      }
    },
    [websiteId, pageId]
  )

  // Handle block update
  const handleBlockUpdate = useCallback(
    async (blockId: string, updates: Partial<AdminBlock>) => {
      // Optimistic update
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, ...updates } : b))
      )
      setSaveStatus("saving")

      try {
        const response = await fetch(
          `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          }
        )

        if (!response.ok) {
          throw new Error("Failed to update block")
        }

        setSaveStatus("saved")
      } catch (error) {
        setSaveStatus("unsaved")
        toast.error("Failed to save changes")
      }
    },
    [websiteId, pageId]
  )

  // Handle block delete
  const handleBlockDelete = useCallback(
    async (blockId: string) => {
      try {
        const response = await fetch(
          `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
          {
            method: "DELETE",
          }
        )

        if (!response.ok) {
          throw new Error("Failed to delete block")
        }

        setBlocks((prev) => prev.filter((b) => b.id !== blockId))
        if (selectedBlockId === blockId) {
          setSelectedBlockId(null)
        }
        toast.success("Block deleted")
      } catch (error) {
        toast.error("Failed to delete block")
      }
    },
    [websiteId, pageId, selectedBlockId]
  )

  // Handle adding new block
  const handleAddBlock = useCallback(
    async (blockData: { name: string; type: AdminBlock["type"]; content?: Record<string, unknown>; settings?: Record<string, unknown> }) => {
      try {
        const response = await fetch(
          `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: [{
                ...blockData,
                order: blocks.length,
                status: "Active",
              }],
            }),
          }
        )

        if (!response.ok) {
          throw new Error("Failed to create block")
        }

        const data = await response.json()
        if (data.blocks?.[0]) {
          setBlocks((prev) => [...prev, data.blocks[0]])
          setSelectedBlockId(data.blocks[0].id)
          toast.success("Block added")
        }
      } catch (error) {
        toast.error("Failed to add block")
      }
    },
    [websiteId, pageId, blocks.length]
  )

  // Handle deselect
  const handleDeselect = useCallback(() => {
    setSelectedBlockId(null)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDeselect()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleDeselect])

  // Auto-open right panel when a block is selected
  useEffect(() => {
    if (selectedBlockId && !rightPanelOpen) {
      setRightPanelOpen(true)
    }
  }, [selectedBlockId])

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = previewUrl
    }
  }, [previewUrl])

  return (
    <div className="visual-editor-container">
      {/* Left Panel: Block List */}
      <div className={`visual-editor-left-panel ${!leftPanelOpen ? "collapsed" : ""}`}>
        <BlockListPanel
          blocks={blocks}
          selectedBlockId={selectedBlockId}
          hoveredBlockId={hoveredBlockId}
          onBlockSelect={handleBlockSelect}
          onBlockHover={handleBlockHover}
          onBlockReorder={handleBlockReorder}
          onAddBlock={handleAddBlock}
        />
      </div>

      {/* Center Panel: Preview with Toolbar */}
      <div className="visual-editor-center-panel">
        {/* Toolbar */}
        <div className="visual-editor-toolbar">
          <div className="visual-editor-toolbar-left">
            <Tooltip content={leftPanelOpen ? "Hide blocks" : "Show blocks"}>
              <button
                className={`visual-editor-toggle-btn ${leftPanelOpen ? "active" : ""}`}
                onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              >
                <SidebarLeft />
              </button>
            </Tooltip>
          </div>

          <div className="visual-editor-toolbar-center">
            <div className="visual-editor-url-display">
              <span className="visual-editor-url-text">{previewUrl.replace("?visual_editor=true", "")}</span>
            </div>
            <Tooltip content="Refresh preview">
              <button
                className="visual-editor-toggle-btn"
                onClick={handleRefresh}
              >
                <ArrowPath />
              </button>
            </Tooltip>
          </div>

          <div className="visual-editor-toolbar-right">
            <Tooltip content={rightPanelOpen ? "Hide properties" : "Show properties"}>
              <button
                className={`visual-editor-toggle-btn ${rightPanelOpen ? "active" : ""}`}
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
              >
                <SidebarRight />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Preview */}
        <div className="visual-editor-preview-wrapper">
          <PreviewPanel
            ref={iframeRef}
            previewUrl={previewUrl}
            iframeReady={iframeReady}
            selectedBlockId={selectedBlockId}
          />
        </div>
      </div>

      {/* Right Panel: Property Editor */}
      <div className={`visual-editor-right-panel ${!rightPanelOpen ? "collapsed" : ""}`}>
        {selectedBlock ? (
          <PropertyEditorPanel
            block={selectedBlock}
            websiteId={websiteId}
            pageId={pageId}
            onUpdate={(updates) => handleBlockUpdate(selectedBlock.id, updates)}
            onDelete={() => handleBlockDelete(selectedBlock.id)}
            onClose={handleDeselect}
            saveStatus={saveStatus}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <CursorArrowRays className="text-ui-fg-muted opacity-40 mb-3" />
            <p className="text-ui-fg-subtle text-sm">
              Click a block in the preview or list to edit
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function getPreviewUrl(slug: string): string {
  // Get the preview URL from environment or use default
  const baseUrl = import.meta.env.VITE_PREVIEW_URL || "http://localhost:3000"
  const path = slug === "home" ? "/" : `/${slug}`
  return `${baseUrl}${path}?visual_editor=true`
}
