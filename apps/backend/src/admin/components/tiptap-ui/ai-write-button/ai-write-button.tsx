import * as React from "react"
import { type Editor } from "@tiptap/react"
import { toast } from "@medusajs/ui"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { useNewsletterAiWrite } from "@/hooks/api/marketing"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button } from "@/components/tiptap-ui-primitive/button"

export interface AiWriteButtonProps extends Omit<ButtonProps, "type"> {
  /** The TipTap editor instance (falls back to the editor context). */
  editor?: Editor | null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Build TipTap-insertable HTML from the structured newsletter payload returned
 * by the generate endpoint: intro paragraph + a "<h2>heading</h2><p>body</p>"
 * block per section. Falls back to the flat content string when no payload.
 */
export function newsletterPayloadToHtml(
  payload: unknown,
  fallbackContent = ""
): string {
  const p = (payload ?? {}) as {
    intro?: string
    sections?: Array<{ heading?: string; body?: string }>
  }
  const parts: string[] = []
  const intro = typeof p.intro === "string" ? p.intro.trim() : ""
  if (intro) parts.push(`<p>${escapeHtml(intro)}</p>`)
  const sections = Array.isArray(p.sections) ? p.sections : []
  for (const s of sections) {
    const h = typeof s?.heading === "string" ? s.heading.trim() : ""
    const b = typeof s?.body === "string" ? s.body.trim() : ""
    if (h) parts.push(`<h2>${escapeHtml(h)}</h2>`)
    if (b) parts.push(`<p>${escapeHtml(b)}</p>`)
  }
  if (parts.length) return parts.join("")
  const fb = fallbackContent.trim()
  return fb ? `<p>${escapeHtml(fb)}</p>` : ""
}

/**
 * Toolbar action: generate a newsletter draft via the ai_newsletter_drafter
 * provider (env OpenRouter fallback) and INSERT it inline at the cursor — the
 * in-editor half of the "Write with AI" feature (#659). Pairs with the create
 * form's "Write with AI" button (which seeds title + summary).
 */
export const AiWriteButton = React.forwardRef<
  HTMLButtonElement,
  AiWriteButtonProps
>(
  (
    { editor: providedEditor, className = "", onClick, children, ...buttonProps },
    ref
  ) => {
    const editor = useTiptapEditor(providedEditor)
    const { mutateAsync: writeNewsletter, isPending } = useNewsletterAiWrite()

    const handleClick = React.useCallback(
      async (e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || !editor || isPending) return
        try {
          const res = await writeNewsletter()
          const html = newsletterPayloadToHtml(
            (res as { payload?: unknown }).payload,
            res.content || ""
          )
          if (!html) {
            toast.info("The AI returned nothing — try again.")
            return
          }
          editor.chain().focus().insertContent(html).run()
          toast.success("Drafted with AI — edit inline.")
        } catch {
          toast.error(
            "AI draft failed — configure an AI provider (role ai_newsletter_drafter) or OPENROUTER_API_KEY."
          )
        }
      },
      [editor, isPending, onClick, writeNewsletter]
    )

    if (!editor || !editor.isEditable) {
      return null
    }

    return (
      <Button
        type="button"
        className={className.trim()}
        data-style="ghost"
        disabled={isPending}
        role="button"
        tabIndex={-1}
        aria-label="Write with AI"
        tooltip="Write with AI"
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children || <span className="tiptap-button-text">✨ AI</span>}
      </Button>
    )
  }
)

AiWriteButton.displayName = "AiWriteButton"

export default AiWriteButton
