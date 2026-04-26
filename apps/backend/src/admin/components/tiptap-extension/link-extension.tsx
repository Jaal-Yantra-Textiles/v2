import TiptapLink from "@tiptap/extension-link"
import type { EditorView } from "@tiptap/pm/view"
import { getMarkRange } from "@tiptap/react"
import { Plugin, TextSelection } from "@tiptap/pm/state"

export const Link = TiptapLink.extend({
  inclusive: false,

  parseHTML() {
    return [
      {
        tag: 'a[href]:not([data-type="button"]):not([href *= "javascript:" i])',
        getAttrs: (dom: HTMLElement) => {
          const href = dom.getAttribute('href')
          return href ? { href } : false
        },
      },
    ]
  },

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('href'),
        renderHTML: (attributes: { href?: string; target?: string }) => {
          if (!attributes.href) {
            return {}
          }
          return {
            href: attributes.href,
            target: attributes.target || '_blank',
            rel: 'noopener noreferrer nofollow',
          }
        },
      },
      target: {
        default: '_blank',
      },
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this

    return [
      new Plugin({
        props: {
          handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
            const { selection } = editor.state

            // Handle Escape key to clear selection or exit link editing
            if (event.key === "Escape") {
              if (!selection.empty) {
                editor.commands.focus(selection.to, { scrollIntoView: false })
                return true
              }
              // If we're in a link, move cursor to end of link
              if (editor.isActive('link')) {
                const { from } = selection
                const linkRange = getMarkRange(view.state.doc.resolve(from), view.state.schema.marks.link)
                if (linkRange) {
                  editor.commands.focus(linkRange.to)
                  return true
                }
              }
            }

            return false
          },
          
          handleClick(view, pos, event) {
            const { schema, doc, tr } = view.state
            
            // Don't handle if it's a modifier click (Ctrl/Cmd + click should open link)
            if (event.ctrlKey || event.metaKey) {
              return false
            }

            let range: ReturnType<typeof getMarkRange> | undefined

            if (schema.marks.link) {
              range = getMarkRange(doc.resolve(pos), schema.marks.link)
            }

            if (!range) {
              return false
            }

            const { from, to } = range
            const start = Math.min(from, to)
            const end = Math.max(from, to)

            // Only handle clicks within the link range
            if (pos < start || pos > end) {
              return false
            }

            // Select the entire link text for easy editing
            const $start = doc.resolve(start)
            const $end = doc.resolve(end)
            const transaction = tr.setSelection(new TextSelection($start, $end))

            view.dispatch(transaction)
            return true
          },
        },
      }),
    ]
  },
})

export default Link