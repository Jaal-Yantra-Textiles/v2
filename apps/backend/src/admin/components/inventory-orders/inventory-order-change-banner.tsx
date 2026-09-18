import { Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { CheckCircleSolid, ExclamationCircleSolid, XCircleSolid } from "@medusajs/icons"
import { useMemo } from "react"

import { AdminInventoryOrder } from "../../hooks/api/inventory-orders"
import {
  useApproveInventoryOrderChange,
  useInventoryOrderChanges,
  useRejectInventoryOrderChange,
  type AdminInventoryOrderChange,
} from "../../hooks/api/inventory-orders"

type InventoryOrderChangeBannerProps = {
  inventoryOrder: AdminInventoryOrder
}

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : `₹${Number(n)}`

/**
 * #1752 — the partner's proposed revision, shown as a striped banner across the
 * top of the inventory-order detail (the same visual language Medusa core uses
 * for a pending order-change). An operator approves or rejects it here; until
 * then the proposal has NOT touched the real lines or the payable ceiling.
 *
 * Renders only when a PENDING change exists — resolved (approved/rejected)
 * changes are history, not a call to action. No banner = nothing to decide.
 */
export const InventoryOrderChangeBanner = ({
  inventoryOrder,
}: InventoryOrderChangeBannerProps) => {
  const prompt = usePrompt()

  const { changes } = useInventoryOrderChanges(inventoryOrder.id)
  const { mutateAsync: approve } = useApproveInventoryOrderChange(inventoryOrder.id)
  const { mutateAsync: reject } = useRejectInventoryOrderChange(inventoryOrder.id)

  const pending = useMemo<AdminInventoryOrderChange | undefined>(() => {
    const list = Array.isArray(changes) ? changes : []
    return list.find((c) => c?.status === "pending")
  }, [changes])

  // Resolve proposed line ids to their titles for a readable diff.
  const lineById = useMemo(() => {
    const map = new Map<string, any>()
    const lines = (inventoryOrder as any).orderlines ?? inventoryOrder.order_lines ?? []
    for (const l of Array.isArray(lines) ? lines : []) {
      if (l?.id) map.set(l.id, l)
    }
    return map
  }, [inventoryOrder])

  if (!pending) {
    return null
  }

  const proposedLines = Array.isArray(pending.proposed_lines)
    ? pending.proposed_lines
    : []
  const proposedCharges = Array.isArray(pending.proposed_charges)
    ? pending.proposed_charges
    : []

  const removed = proposedLines.filter((l) => l.remove)
  const edited = proposedLines.filter((l) => !l.remove)
  const taxTotal = proposedCharges.reduce(
    (sum, c) => sum + (Number(c?.amount) || 0),
    0
  )

  const labelFor = (id: string) => {
    const line = lineById.get(id)
    return (
      line?.material_name ||
      line?.inventory_items?.[0]?.title ||
      line?.inventory_items?.[0]?.name ||
      id
    )
  }

  const onApprove = async () => {
    const confirmed = await prompt({
      title: "Approve partner changes?",
      description:
        "This applies the proposed line edits and tax to the order and raises the payable ceiling. It cannot be undone.",
      confirmText: "Approve",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await approve(pending.id)
      toast.success("Change approved")
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve change")
    }
  }

  const onReject = async () => {
    const confirmed = await prompt({
      title: "Reject partner changes?",
      description:
        "The proposal will be closed and the order stays as it was. The partner can propose again.",
      confirmText: "Reject",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await reject({ changeId: pending.id })
      toast.success("Change rejected")
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject change")
    }
  }

  return (
    <div
      style={{
        background:
          "repeating-linear-gradient(-45deg, rgb(212, 212, 216, 0.15), rgb(212, 212, 216,.15) 10px, transparent 10px, transparent 20px)",
      }}
      className="-m-4 mb-1 border-b border-l p-4"
    >
      <Container className="flex flex-col divide-y divide-dashed p-0">
        <div className="flex items-center gap-2 px-6 py-4">
          <ExclamationCircleSolid className="text-blue-500" />
          <Heading level="h2">Partner proposed changes</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            pending approval — not applied yet
          </Text>
        </div>

        {edited.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              Line changes
            </Text>
            {edited.map((l) => {
              const original = lineById.get(l.id)
              return (
                <div key={l.id} className="flex items-center gap-x-3 text-sm">
                  <span className="flex-1 truncate">{labelFor(l.id)}</span>
                  {original ? (
                    <span className="text-ui-fg-muted">
                      {money(original.price)} × {original.quantity} → {money(l.price)} × {l.quantity}
                    </span>
                  ) : (
                    <span className="text-ui-fg-muted">
                      {money(l.price)} × {l.quantity}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {removed.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              Removed lines
            </Text>
            {removed.map((l) => (
              <div key={l.id} className="flex items-center gap-x-3 text-sm">
                <span className="flex-1 truncate line-through">{labelFor(l.id)}</span>
                <XCircleSolid className="text-ui-fg-muted" />
              </div>
            ))}
          </div>
        )}

        {proposedCharges.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              Proposed tax
            </Text>
            {proposedCharges.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-ui-fg-muted">{c.note || "Tax"}</span>
                <span>{money(c.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Tax total</span>
              <span>{money(taxTotal)}</span>
            </div>
          </div>
        )}

        <div className="bg-ui-bg-subtle flex items-center justify-end gap-x-2 rounded-b-xl px-4 py-4">
          <Button size="small" variant="secondary" onClick={onReject}>
            <XCircleSolid />
            Reject
          </Button>
          <Button size="small" variant="primary" onClick={onApprove}>
            <CheckCircleSolid />
            Approve
          </Button>
        </div>
      </Container>
    </div>
  )
}

export default InventoryOrderChangeBanner