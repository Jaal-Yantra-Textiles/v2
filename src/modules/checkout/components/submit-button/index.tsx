"use client"

import { Button } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
import React from "react"
import { useFormStatus } from "react-dom"

export function SubmitButton({
  children,
  variant = "primary",
  className,
  "data-testid": dataTestId,
}: {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "transparent" | "danger" | null
  className?: string
  "data-testid"?: string
}) {
  const { pending } = useFormStatus()

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
