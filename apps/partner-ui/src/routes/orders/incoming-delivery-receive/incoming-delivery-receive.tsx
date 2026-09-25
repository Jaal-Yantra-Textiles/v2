import { Button, Heading, Input, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { WorkOrderLineCard } from "../../../components/work-orders/work-order-line-card"
import {
  useConfirmIncomingDelivery,
  usePartnerIncomingDeliveries,
} from "../../../hooks/api/partner-incoming-deliveries"

/**
 * Confirm what arrived (#2286).
 *
 * Each line starts at what is still outstanding; the partner lowers it to what
 * they actually counted. A short line needs a note — the shortfall is recorded
 * against the supplier's order, and "why" is what makes it actionable.
 */
const fmt = (n: number) => String(Math.round((Number(n) || 0) * 1000) / 1000)

export const IncomingDeliveryReceive = () => (
  <RouteFocusModal>
    <RouteFocusModal.Header>
      <RouteFocusModal.Title asChild>
        <Heading>Confirm receipt</Heading>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description className="sr-only">
        Confirm the quantities that arrived at your warehouse
      </RouteFocusModal.Description>
    </RouteFocusModal.Header>
    <ReceiveForm />
  </RouteFocusModal>
)

const ReceiveForm = () => {
  const { orderId = "" } = useParams()
  const { handleSuccess } = useRouteModal()
  const { incoming_deliveries, isPending } = usePartnerIncomingDeliveries({ all: true })
  const delivery = incoming_deliveries.find((d) => d.id === orderId)
  const { mutateAsync, isPending: isSaving } = useConfirmIncomingDelivery(orderId)

  const openLines = useMemo(
    () => (delivery?.lines ?? []).filter((l) => l.outstanding > 0),
    [delivery]
  )
  const [qty, setQty] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState("")

  useEffect(() => {
    setQty(Object.fromEntries(openLines.map((l) => [l.id, l.outstanding])))
  }, [openLines])

  const short = openLines.filter((l) => (qty[l.id] ?? 0) < l.outstanding)
  const total = openLines.reduce((s, l) => s + (qty[l.id] ?? 0), 0)

  const submit = async () => {
    if (short.length && !notes.trim()) {
      toast.error("Some lines are short — add a note saying what's missing.")
      return
    }
    if (total <= 0) {
      toast.error("Enter at least one quantity that arrived.")
      return
    }
    await mutateAsync(
      {
        lines: openLines.map((l) => ({ order_line_id: l.id, quantity: qty[l.id] ?? 0 })),
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Receipt confirmed — it's in your stock now")
          handleSuccess()
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <>
      <RouteFocusModal.Body className="overflow-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-y-4 px-6 py-6">
          {isPending ? (
            <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
          ) : !delivery ? (
            <Text size="small" className="text-ui-fg-subtle">This delivery could not be found.</Text>
          ) : !delivery.can_confirm ? (
            <Text size="small" className="text-ui-fg-subtle">
              {delivery.cannot_confirm_reason === "not_dispatched"
                ? "This delivery hasn't been dispatched yet, so it can't be confirmed."
                : "Everything on this delivery has already been received."}
            </Text>
          ) : (
            <>
              <Text size="small" className="text-ui-fg-subtle">
                {delivery.from ? `From ${delivery.from}. ` : ""}Enter what you actually counted. Lower a line if less arrived.
              </Text>
              {openLines.map((l) => (
                <WorkOrderLineCard key={l.id} title={l.name ?? l.id} subtitle={`Ordered ${fmt(l.ordered)} ${l.unit ?? ""}`}>
                  <div className="flex items-center gap-x-1">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      max={l.outstanding}
                      className="bg-ui-bg-base txt-small w-[72px] rounded-lg text-right"
                      value={qty[l.id] ?? 0}
                      onChange={(e) => {
                        const raw = Number(e.target.value || 0)
                        setQty((p) => ({ ...p, [l.id]: Math.max(0, Math.min(raw, l.outstanding)) }))
                      }}
                    />
                    <span className="text-ui-fg-subtle whitespace-nowrap">/ {fmt(l.outstanding)} expected</span>
                  </div>
                </WorkOrderLineCard>
              ))}
              <div>
                <Text size="small" weight="plus">Notes{short.length ? " (required — some lines are short)" : ""}</Text>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Linen roll was 0.5 m short" />
              </div>
            </>
          )}
        </div>
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button size="small" isLoading={isSaving} disabled={!delivery?.can_confirm} onClick={submit}>
            Confirm receipt
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}
