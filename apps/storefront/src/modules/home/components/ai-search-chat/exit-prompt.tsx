"use client"

import { useEffect } from "react"

/**
 * Small confirmation dialog used when the user tries to dismiss the
 * onboarding modal with unsaved selections.
 *
 * Modelled on Medusa admin's Prompt usage in route-modal-form.tsx —
 * Cancel keeps the underlying modal open, Continue discards the changes
 * and lets the parent close. Pure Tailwind so we don't pull
 * `@medusajs/ui` into the storefront just for this.
 *
 * Lives on top of the underlying modal — uses z-[60] so the backdrop
 * sits above the chat modal (z-50). Escape on this prompt cancels (NOT
 * proceed) so a stray keystroke doesn't lose work.
 */
type Props = {
  open: boolean
  title?: string
  description?: string
  cancelLabel?: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

export default function ExitPrompt({
  open,
  title = "Unsaved selections",
  description = "You've started telling us what you like. Leave anyway?",
  cancelLabel = "Cancel",
  confirmLabel = "Leave",
  onCancel,
  onConfirm,
}: Props) {
  // Escape on the prompt cancels — never proceed. A user dismissing the
  // chat modal probably wants to undo, not commit to losing input.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exit-prompt-title"
      aria-describedby="exit-prompt-desc"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
    >
      <button
        type="button"
        aria-label="Dismiss prompt"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <h3
          id="exit-prompt-title"
          className="text-base font-medium text-neutral-900 sm:text-lg"
        >
          {title}
        </h3>
        <p
          id="exit-prompt-desc"
          className="mt-1 text-sm text-neutral-600 sm:text-base"
        >
          {description}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 sm:text-base"
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 sm:text-base"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
