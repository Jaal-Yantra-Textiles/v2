// Imported via @tiptap/react (which re-exports @tiptap/core) — @tiptap/core is
// not a direct dependency of this package, only hoisted at the workspace root.
import { Node, mergeAttributes } from "@tiptap/react"

/**
 * The "Insert Video" flow emits nodes of type `youtube` | `vimeo` | `embed` |
 * `video`. None of those exist in StarterKit, so `insertContent` was handing
 * ProseMirror a node type its schema had never heard of — the insert threw and
 * the video never appeared. These two nodes put the types in the schema.
 *
 * `Embed` covers the iframe-based providers (youtube/vimeo/generic embed) and
 * `VideoFile` covers a direct MP4/WebM/OGG URL.
 */

const IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"

export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
    }
  },

  // A single node class handles all three iframe providers, so `youtube` and
  // `vimeo` are parsed/serialised as this node too.
  addOptions() {
    return { HTMLAttributes: {} }
  },

  parseHTML() {
    return [{ tag: "iframe[src]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { class: "tiptap-embed", style: "position:relative;padding-bottom:56.25%;height:0" },
      [
        "iframe",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          style: "position:absolute;top:0;left:0;width:100%;height:100%",
          frameborder: "0",
          allow: IFRAME_ALLOW,
          allowfullscreen: "true",
        }),
      ],
    ]
  },
})

export const VideoFile = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
    }
  },

  addOptions() {
    return { HTMLAttributes: {} }
  },

  parseHTML() {
    return [{ tag: "video[src]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        controls: "true",
        class: "tiptap-video",
      }),
    ]
  },
})
