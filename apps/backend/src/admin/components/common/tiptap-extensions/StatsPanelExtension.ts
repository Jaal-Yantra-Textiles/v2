// @ts-nocheck
import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import StatsPanelNodeView from "./StatsPanelNodeView"

export interface StatsPanelOptions {
  HTMLAttributes: Record<string, any>
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    statsPanel: {
      setStatsPanel: (attrs: { panelId: string; title?: string }) => ReturnType
    }
  }
}

export const StatsPanelExtension = Node.create<StatsPanelOptions>({
  name: "statsPanel",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      panelId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-panel-id"),
        renderHTML: (attrs) =>
          attrs.panelId ? { "data-panel-id": attrs.panelId } : {},
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-title"),
        renderHTML: (attrs) =>
          attrs.title ? { "data-title": attrs.title } : {},
      },
      // Populated server-side by the web blog endpoint before delivery.
      // Editor-time inserts start null; the node view fetches live via the admin API.
      data: {
        default: null,
        rendered: false,
      },
      display: {
        default: null,
        rendered: false,
      },
      panelType: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-panel-type"),
        renderHTML: (attrs) =>
          attrs.panelType ? { "data-panel-type": attrs.panelType } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-stats-panel]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-stats-panel": "",
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setStatsPanel:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(StatsPanelNodeView)
  },
})

export default StatsPanelExtension
