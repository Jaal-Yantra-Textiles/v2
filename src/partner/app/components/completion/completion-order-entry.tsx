"use client"

import { useState } from "react"
import { Button } from "@medusajs/ui"
import CompletionOrderForm, { CompletionLine } from "./completion-order-form"

export default function CompletionOrderEntry({
  lines,
  action,
}: {
  lines: CompletionLine[]
  action: (formData: FormData) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Complete / Ship</Button>
      <CompletionOrderForm open={open} onOpenChange={setOpen} lines={lines} action={action} />
    </>
  )
}
