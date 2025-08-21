"use client"

import { useMemo, useRef } from "react"
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
  // No overlay confirm needed in partial-by-default UX

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

  // Helpers to quickly set quantities
  const fillAllRemaining = () => {
    if (!formRef.current) return
    for (const l of lines) {
      const remaining = remainingMap.get(l.id) || 0
      const el = formRef.current.querySelector<HTMLInputElement>(`input[name="qty_${l.id}"]`)
      if (el) el.value = String(remaining)
    }
  }

  const setAllZero = () => {
    if (!formRef.current) return
    for (const l of lines) {
      const el = formRef.current.querySelector<HTMLInputElement>(`input[name="qty_${l.id}"]`)
      if (el) el.value = "0"
    }
  }

  const handlePrimaryClick = (e: React.MouseEvent) => {
    // We'll inspect current form values to detect changes
    if (!formRef.current) return
    const fd = new FormData(formRef.current)
    // Validate each line: 0 <= qty <= remaining
    for (const l of lines) {
      const raw = fd.get(`qty_${l.id}`)
      const val = typeof raw === "string" ? Number(raw) : NaN
      const remaining = remainingMap.get(l.id) || 0
      if (!(Number.isFinite(val) && val >= 0 && val <= remaining)) {
        e.preventDefault()
        alert(`Invalid delivered quantity for line ${l.id}. It must be between 0 and ${remaining}.`)
        return
      }
    }
    // Require at least one line to deliver (> 0)
    const anyPositive = lines.some((l) => {
      const rv = fd.get(`qty_${l.id}`)
      const v = typeof rv === "string" ? Number(rv) : NaN
      return Number.isFinite(v) && v > 0
    })
    if (!anyPositive) {
      e.preventDefault()
      alert("Please set at least one line quantity greater than 0 to deliver.")
      return
    }
    // Let the form submit normally
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
                  Edit quantities to deliver per line. Default is 0 (untouched lines are delivered as 0 for this shipment).
                </Text>
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={setAllZero}>Set all to 0</Button>
                <Button type="button" variant="secondary" onClick={fillAllRemaining}>Fill all with remaining</Button>
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
                              step="any"
                              inputMode="decimal"
                              name={`qty_${l.id}`}
                              defaultValue={0}
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
    </>
  )
}
