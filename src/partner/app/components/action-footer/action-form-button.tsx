"use client"

import { Button } from "@medusajs/ui"
import { useFormStatus } from "react-dom"

export default function ActionFormButton({
  action,
  children,
  variant = "secondary",
  size = "base",
  type = "submit",
  className,
  fullWidth,
}: {
  action: () => Promise<void>
  children: React.ReactNode
  variant?: "secondary" | "primary" | "danger"
  size?: "small" | "base" | "large"
  type?: "button" | "submit" | "reset"
  className?: string
  fullWidth?: boolean
}) {
  function SubmitButton({ children }: { children: React.ReactNode }) {
    const { pending } = useFormStatus()
    return (
      <Button
        size={size}
        variant={variant}
        type={type}
        disabled={pending}
        isLoading={pending}
        className={`${className ?? ""} ${fullWidth ? "w-full" : ""}`.trim()}
      >
        {children}
      </Button>
    )
  }
  return (
    <form action={action} className={fullWidth ? "w-full" : undefined}>
      <SubmitButton>{children}</SubmitButton>
    </form>
  )
}
