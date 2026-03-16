"use client"

import { useEffect, useCallback, useRef } from "react"

type BlockInfo = {
  id: string
  type: string
  name: string
  rect?: { top: number; left: number; width: number; height: number }
}

type AdminToIframeMessage =
  | { type: "VISUAL_EDITOR_INIT"; editMode: true }
  | { type: "SELECT_BLOCK"; blockId: string }
  | { type: "HIGHLIGHT_BLOCK"; blockId: string | null }
  | { type: "UPDATE_BLOCK_PREVIEW"; blockId: string; content: Record<string, unknown>; settings?: Record<string, unknown> }
  | { type: "SCROLL_TO_BLOCK"; blockId: string }

type IframeToAdminMessage =
  | { type: "VISUAL_EDITOR_READY"; blocks: BlockInfo[] }
  | { type: "BLOCK_CLICKED"; blockId: string; blockType: string; blockName: string }
  | { type: "BLOCK_HOVERED"; blockId: string | null }
  | { type: "BLOCKS_LOADED"; blocks: BlockInfo[] }

interface VisualEditorBridgeProps {
  blocks: Array<{
    id?: string
    name?: string
    type?: string
    content?: Record<string, unknown>
    order?: number
  }>
}

const OVERLAY_ID = "ve-overlay"
const STYLE_ID = "ve-styles"

function getBlockElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-block-id]")) as HTMLElement[]
}

function getBlockById(blockId: string): HTMLElement | null {
  return document.querySelector(`[data-block-id="${blockId}"]`)
}

function collectBlockInfo(): BlockInfo[] {
  return getBlockElements().map((el) => {
    const rect = el.getBoundingClientRect()
    return {
      id: el.dataset.blockId!,
      type: el.dataset.blockType || "",
      name: el.dataset.blockName || "",
      rect: {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      },
    }
  })
}

function sendToParent(message: IframeToAdminMessage) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, "*")
  }
}

export default function VisualEditorBridge({ blocks }: VisualEditorBridgeProps) {
  const selectedRef = useRef<string | null>(null)
  const highlightedRef = useRef<string | null>(null)

  // Inject editor styles once
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return

    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = `
      [data-block-id] {
        position: relative;
        transition: outline 0.15s ease, box-shadow 0.15s ease;
        cursor: pointer;
      }
      [data-block-id]:hover {
        outline: 2px dashed rgba(59, 130, 246, 0.4);
        outline-offset: 2px;
      }
      [data-block-id].ve-selected {
        outline: 2px solid rgb(59, 130, 246) !important;
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
      }
      [data-block-id].ve-highlighted {
        outline: 2px dashed rgb(59, 130, 246) !important;
        outline-offset: 2px;
      }
      .ve-block-label {
        position: absolute;
        top: -22px;
        left: 0;
        background: rgb(59, 130, 246);
        color: white;
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px;
        border-radius: 4px 4px 0 0;
        z-index: 9999;
        pointer-events: none;
        white-space: nowrap;
        font-family: system-ui, -apple-system, sans-serif;
      }
    `
    document.head.appendChild(style)

    return () => {
      style.remove()
    }
  }, [])

  const clearSelection = useCallback(() => {
    const prev = selectedRef.current
      ? getBlockById(selectedRef.current)
      : null
    if (prev) {
      prev.classList.remove("ve-selected")
      prev.querySelector(".ve-block-label")?.remove()
    }
    selectedRef.current = null
  }, [])

  const clearHighlight = useCallback(() => {
    const prev = highlightedRef.current
      ? getBlockById(highlightedRef.current)
      : null
    if (prev) {
      prev.classList.remove("ve-highlighted")
    }
    highlightedRef.current = null
  }, [])

  const selectBlock = useCallback(
    (blockId: string) => {
      clearSelection()
      const el = getBlockById(blockId)
      if (!el) return

      el.classList.add("ve-selected")
      selectedRef.current = blockId

      // Add label
      if (!el.querySelector(".ve-block-label")) {
        const label = document.createElement("div")
        label.className = "ve-block-label"
        label.textContent = `${el.dataset.blockType || "Block"}: ${el.dataset.blockName || blockId}`
        el.style.position = "relative"
        el.appendChild(label)
      }
    },
    [clearSelection]
  )

  const highlightBlock = useCallback(
    (blockId: string | null) => {
      clearHighlight()
      if (!blockId) return
      if (blockId === selectedRef.current) return // don't highlight the selected block

      const el = getBlockById(blockId)
      if (!el) return

      el.classList.add("ve-highlighted")
      highlightedRef.current = blockId
    },
    [clearHighlight]
  )

  const scrollToBlock = useCallback((blockId: string) => {
    const el = getBlockById(blockId)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [])

  const updateBlockPreview = useCallback(
    (blockId: string, content: Record<string, unknown>, settings?: Record<string, unknown>) => {
      const el = getBlockById(blockId)
      if (!el) return

      const type = (el.dataset.blockType || "").toLowerCase()

      // Hero block: update title/subtitle
      if (type.includes("hero")) {
        if (content.title !== undefined) {
          const h1 = el.querySelector("h1")
          if (h1) h1.textContent = content.title as string
        }
        if (content.subtitle !== undefined) {
          const p = el.querySelector("p")
          if (p) p.textContent = content.subtitle as string
        }
      }

      // Main/MainContent block: update title
      if (type.includes("main")) {
        if (content.title !== undefined) {
          const h2 = el.querySelector("h2")
          if (h2) h2.textContent = content.title as string
        }
        // For body changes, a full reload is more reliable than client-side re-render
        // The admin debounces saves → the iframe auto-refreshes after save
      }

      // Apply settings (background color, text color, padding)
      if (settings) {
        if (settings.backgroundColor) {
          el.style.backgroundColor = settings.backgroundColor as string
        }
        if (settings.textColor) {
          el.style.color = settings.textColor as string
        }
        if (settings.padding) {
          el.style.padding = settings.padding as string
        }
      }
    },
    []
  )

  // Handle messages from admin panel
  useEffect(() => {
    const handleMessage = (event: MessageEvent<AdminToIframeMessage>) => {
      const data = event.data
      if (!data || typeof data !== "object" || !("type" in data)) return

      switch (data.type) {
        case "VISUAL_EDITOR_INIT":
          // Respond with block info
          sendToParent({
            type: "VISUAL_EDITOR_READY",
            blocks: collectBlockInfo(),
          })
          break

        case "SELECT_BLOCK":
          selectBlock(data.blockId)
          scrollToBlock(data.blockId)
          break

        case "HIGHLIGHT_BLOCK":
          highlightBlock(data.blockId)
          break

        case "SCROLL_TO_BLOCK":
          scrollToBlock(data.blockId)
          break

        case "UPDATE_BLOCK_PREVIEW":
          updateBlockPreview(data.blockId, data.content, data.settings)
          break
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [selectBlock, highlightBlock, scrollToBlock, updateBlockPreview])

  // Setup click and hover handlers on block elements
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const blockEl = (e.target as HTMLElement).closest("[data-block-id]") as HTMLElement | null
      if (!blockEl) return

      e.preventDefault()
      e.stopPropagation()

      const blockId = blockEl.dataset.blockId!
      const blockType = blockEl.dataset.blockType || ""
      const blockName = blockEl.dataset.blockName || ""

      selectBlock(blockId)
      sendToParent({ type: "BLOCK_CLICKED", blockId, blockType, blockName })
    }

    const handleMouseOver = (e: MouseEvent) => {
      const blockEl = (e.target as HTMLElement).closest("[data-block-id]") as HTMLElement | null
      const blockId = blockEl?.dataset.blockId || null

      if (blockId !== highlightedRef.current) {
        highlightBlock(blockId)
        sendToParent({ type: "BLOCK_HOVERED", blockId })
      }
    }

    const handleMouseLeave = () => {
      clearHighlight()
      sendToParent({ type: "BLOCK_HOVERED", blockId: null })
    }

    document.addEventListener("click", handleClick, true)
    document.addEventListener("mouseover", handleMouseOver)
    document.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      document.removeEventListener("click", handleClick, true)
      document.removeEventListener("mouseover", handleMouseOver)
      document.removeEventListener("mouseleave", handleMouseLeave)
    }
  }, [selectBlock, highlightBlock, clearHighlight])

  // Send ready signal on mount (in case parent already sent INIT before we mounted)
  useEffect(() => {
    const timer = setTimeout(() => {
      sendToParent({
        type: "VISUAL_EDITOR_READY",
        blocks: collectBlockInfo(),
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [])

  // Disable navigation in editor mode
  useEffect(() => {
    const handleLinkClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a")
      if (link && !link.closest("[data-block-id]")) {
        // Allow clicks on block elements (handled above)
        // But prevent navigation from nav/footer links
        const href = link.getAttribute("href")
        if (href && href !== "#" && !href.startsWith("javascript:")) {
          e.preventDefault()
        }
      }
    }

    document.addEventListener("click", handleLinkClick, true)
    return () => document.removeEventListener("click", handleLinkClick, true)
  }, [])

  return null // This component is purely side-effects
}
