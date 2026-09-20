"use client"

import { Button } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
import React from "react"
import { useFormStatus } from "react-dom"

export function SubmitButton({
  children,
  variant = "primary",
  className,
  pending: pendingProp,
  "data-testid": dataTestId,
}: {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "transparent" | "danger" | null
  className?: string
  /**
   * Force the pending state.
   *
   * 🔴 `useFormStatus` only reports pending for a form submitted through a
   * SERVER ACTION. A form that calls `preventDefault()` and does its own
   * `fetch` — which the discount code form does — leaves `pending` false for
   * the entire request, so the button never disabled and never spun, and a
   * shopper could submit the same code repeatedly with no feedback at all.
   */
  pending?: boolean
  "data-testid"?: string
}) {
  const { pending: formPending } = useFormStatus()
  const pending = pendingProp ?? formPending

  return (
    <Button
      size="large"
      className={className}
      type="submit"
      disabled={pending}
      variant={variant || "primary"}
      data-testid={dataTestId}
    >
      {pending ? <Spinner className="animate-spin" /> : children}
    </Button>
  )
}
