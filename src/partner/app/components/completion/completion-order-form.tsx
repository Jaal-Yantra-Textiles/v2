"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Button, FocusModal, Heading, Input, Label, Table, Text } from "@medusajs/ui"
import { useFormStatus } from "react-dom"

export type CompletionLine = {
  id: string
  // Total requested quantity for the line
  requested: number
  // Already fulfilled quantity (sum of prior fulfillments)
  fulfilled: number
}

export default function CompletionOrderForm({
  open,
  onOpenChange,
  lines,
  action,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lines: CompletionLine[]
  action: (formData: FormData) => void | Promise<void>
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [overlayRoot, setOverlayRoot] = useState<Element | null>(null)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOverlayRoot(document.getElementById('partner-overlay-root'))
    }
  }, [])

  // Remaining to deliver and default values
  const remainingMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) {
      const requested = Number(l.requested) || 0
      const fulfilled = Number(l.fulfilled) || 0
      const remaining = Math.max(0, requested - fulfilled)
      m.set(l.id, remaining)
    }
    return m
  }, [lines])

  const handlePrimaryClick = (e: React.MouseEvent) => {
    // We'll inspect current form values to detect changes
    if (!formRef.current) return
    const fd = new FormData(formRef.current)
    // Validate each line: 0 <= qty <= remaining
    for (const l of lines) {
      const val = Number(fd.get(`qty_${l.id}`) as any)
      const remaining = remainingMap.get(l.id) || 0
      if (!(Number.isFinite(val) && val >= 0 && val <= remaining)) {
        e.preventDefault()
        alert(`Invalid delivered quantity for line ${l.id}. It must be between 0 and ${remaining}.`)
        return
      }
    }
    const changed = lines.some((l) => {
      const v = Number(fd.get(`qty_${l.id}`) as any)
      const base = remainingMap.get(l.id) || 0
      return !Number.isFinite(v) ? false : v !== base
    })
    if (!changed) {
      e.preventDefault()
      setShowConfirm(true)
      return
    }
    // Let the form submit normally
  }

  const confirmFullQuantity = () => {
    setShowConfirm(false)
    // Submit with full quantities as filled in the form (which are already defaulted)
    formRef.current?.requestSubmit()
  }

  function SubmitButton({ children }: { children: React.ReactNode }) {
    const { pending } = useFormStatus()
    return (
      <Button type="submit" variant="primary" onClick={handlePrimaryClick} disabled={pending} isLoading={pending}>
        {children}
      </Button>
    )
  }

  return (
    <>
      <FocusModal open={open} onOpenChange={onOpenChange}>
        <FocusModal.Content className="max-w-3xl w-full mx-auto my-8 z-[80]">
            <FocusModal.Title></FocusModal.Title>
          <FocusModal.Header>
            <Heading>Complete / Ship Order</Heading>
          </FocusModal.Header>
          <FocusModal.Body className="size-full overflow-hidden p-0">
            <form ref={formRef} action={action} className="flex flex-col gap-y-6 p-6">
              <div>
                <Heading level="h3" className="mb-2">Delivered Quantities</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Edit quantities to deliver per line. Default is remaining (= requested - delivered so far).
                </Text>
              </div>

              <div className="overflow-x-auto rounded-md border border-ui-border-base">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Line ID</Table.HeaderCell>
                      <Table.HeaderCell className="w-40">Deliver Now</Table.HeaderCell>
                      <Table.HeaderCell>Requested</Table.HeaderCell>
                      <Table.HeaderCell>Delivered So Far</Table.HeaderCell>
                      <Table.HeaderCell>Remaining</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {lines.map((l) => {
                      const requested = Number(l.requested) || 0
                      const fulfilled = Number(l.fulfilled) || 0
                      const remaining = Math.max(0, requested - fulfilled)
                      return (
                        <Table.Row key={l.id}>
                          <Table.Cell>
                            <Text size="small" className="break-all">{l.id}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <input type="hidden" name={`requested_${l.id}`} value={requested} />
                            <input type="hidden" name={`fulfilled_${l.id}`} value={fulfilled} />
                            <Input
                              type="number"
                              min={0}
                              max={remaining}
                              step={1}
                              name={`qty_${l.id}`}
                              defaultValue={remaining}
                            />
                          </Table.Cell>
                          <Table.Cell>
                            <Text size="small">{requested}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text size="small">{fulfilled}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text size="small">{remaining}</Text>
                          </Table.Cell>
                        </Table.Row>
                      )
                    })}
                  </Table.Body>
                </Table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="tracking_number">Tracking Number</Label>
                  <Input id="tracking_number" name="tracking_number" placeholder="e.g. TRACK123456" />
                </div>
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="deliveryDate">Delivery Date</Label>
                  <Input id="deliveryDate" name="deliveryDate" type="date" />
                </div>
                <div className="flex flex-col gap-y-1 md:col-span-1">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" name="notes" placeholder="Optional note" />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
                <SubmitButton>Complete Order</SubmitButton>
              </div>
            </form>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>

      {showConfirm && createPortal((
        <div
          className="fixed inset-0 z-[100000] pointer-events-auto"
          aria-modal="true"
          role="dialog"
          tabIndex={-1}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          {/* Centered dialog */}
          <div className="relative z-[100001] h-full w-full flex items-center justify-center p-4 pointer-events-none">
            <div className="w-full max-w-md rounded-lg bg-ui-bg-base shadow-elevation-flyout border border-ui-border-base pointer-events-auto">
              <div className="p-5 border-b border-ui-border-base">
                <Heading level="h3">Complete with full quantities?</Heading>
              </div>
              <div className="p-5">
                <Text size="small" className="text-ui-fg-subtle">
                  You haven't edited any quantities. The full requested quantities will be marked as delivered. Proceed?
                </Text>
              </div>
              <div className="p-5 pt-0 flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowConfirm(false)}>Cancel</Button>
                <Button variant="primary" onClick={confirmFullQuantity}>Yes, complete with full quantities</Button>
              </div>
            </div>
          </div>
        </div>
      ), overlayRoot || document.body)}
    </>
  )
}
