import { useCallback, useEffect, useState, RefObject } from "react"

// Message types from admin to iframe
export type AdminToIframeMessage =
  | { type: "VISUAL_EDITOR_INIT"; editMode: true }
  | { type: "SELECT_BLOCK"; blockId: string }
  | { type: "HIGHLIGHT_BLOCK"; blockId: string | null }
  | { type: "UPDATE_BLOCK_PREVIEW"; blockId: string; content: Record<string, unknown>; settings?: Record<string, unknown> }
  | { type: "SCROLL_TO_BLOCK"; blockId: string }

// Message types from iframe to admin
export type IframeToAdminMessage =
  | { type: "VISUAL_EDITOR_READY"; blocks: BlockInfo[] }
  | { type: "BLOCK_CLICKED"; blockId: string; blockType: string; blockName: string }
  | { type: "BLOCK_HOVERED"; blockId: string | null }
  | { type: "BLOCKS_LOADED"; blocks: BlockInfo[] }

export interface BlockInfo {
  id: string
  type: string
  name: string
  rect?: { top: number; left: number; width: number; height: number }
}

interface UseIframeCommunicationOptions {
  iframeRef: RefObject<HTMLIFrameElement>
  onBlockClicked?: (blockId: string, blockType?: string, blockName?: string) => void
  onBlockHovered?: (blockId: string | null) => void
  onBlocksLoaded?: (blocks: BlockInfo[]) => void
}

export function useIframeCommunication({
  iframeRef,
  onBlockClicked,
  onBlockHovered,
  onBlocksLoaded,
}: UseIframeCommunicationOptions) {
  const [iframeReady, setIframeReady] = useState(false)
  const [iframeBlocks, setIframeBlocks] = useState<BlockInfo[]>([])

  // Handle messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent<IframeToAdminMessage>) => {
      // Validate message source (in production, check origin)
      const data = event.data

      if (!data || typeof data !== "object" || !("type" in data)) {
        return
      }

      switch (data.type) {
        case "VISUAL_EDITOR_READY":
          setIframeReady(true)
          setIframeBlocks(data.blocks || [])
          onBlocksLoaded?.(data.blocks || [])
          break

        case "BLOCK_CLICKED":
          onBlockClicked?.(data.blockId, data.blockType, data.blockName)
          break

        case "BLOCK_HOVERED":
          onBlockHovered?.(data.blockId)
          break

        case "BLOCKS_LOADED":
          setIframeBlocks(data.blocks || [])
          onBlocksLoaded?.(data.blocks || [])
          break
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [onBlockClicked, onBlockHovered, onBlocksLoaded])

  // Send init message when iframe loads
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const handleLoad = () => {
      sendMessage({ type: "VISUAL_EDITOR_INIT", editMode: true })
    }

    iframe.addEventListener("load", handleLoad)
    return () => iframe.removeEventListener("load", handleLoad)
  }, [iframeRef])

  // Helper to send messages to iframe
  const sendMessage = useCallback(
    (message: AdminToIframeMessage) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return

      try {
        iframe.contentWindow.postMessage(message, "*")
      } catch (error) {
        console.error("Failed to send message to iframe:", error)
      }
    },
    [iframeRef]
  )

  // Select a block in the iframe
  const selectBlock = useCallback(
    (blockId: string) => {
      sendMessage({ type: "SELECT_BLOCK", blockId })
    },
    [sendMessage]
  )

  // Highlight a block on hover
  const highlightBlock = useCallback(
    (blockId: string | null) => {
      sendMessage({ type: "HIGHLIGHT_BLOCK", blockId })
    },
    [sendMessage]
  )

  // Update block preview (optimistic update)
  const updateBlockPreview = useCallback(
    (blockId: string, content: Record<string, unknown>, settings?: Record<string, unknown>) => {
      sendMessage({ type: "UPDATE_BLOCK_PREVIEW", blockId, content, settings })
    },
    [sendMessage]
  )

  // Scroll to a block in the iframe
  const scrollToBlock = useCallback(
    (blockId: string) => {
      sendMessage({ type: "SCROLL_TO_BLOCK", blockId })
    },
    [sendMessage]
  )

  return {
    iframeReady,
    iframeBlocks,
    selectBlock,
    highlightBlock,
    updateBlockPreview,
    scrollToBlock,
  }
}
