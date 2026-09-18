import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { ExclamationCircleSolid } from "@medusajs/icons"
import { useTranslation } from "react-i18next"

import type { PartnerInventoryOrder } from "../../hooks/api/partner-inventory-orders"
import { getLocaleAmount } from "../../lib/money-amount-helpers"

const fmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "0" : String(Math.round(Number(n) * 1000) / 1000)

/**
 * #1752 — the partner's OWN proposed revision, shown as a striped banner on the
 * inventory work-order detail (same visual language as Medusa core's
 * order-change banner). It is informational + a lock: while a proposal is
 * pending, the partner's lifecycle actions are paused until the admin approves
 * or rejects it (see WorkOrderStatusSection).
 */
export const InventoryOrderChangeBanner = ({
  inventoryOrder,
  currencyCode,
}: {
  inventoryOrder: PartnerInventoryOrder
  currencyCode?: string
}) => {
  const { t } = useTranslation()

  const pending = inventoryOrder?.pending_change ?? null
  if (!pending) return null

  const lineById = new Map<string, any>()
  for (const l of inventoryOrder?.order_lines ?? []) {
    if (l?.id) lineById.set(l.id, l)
  }

  const proposedLines = Array.isArray(pending.proposed_lines)
    ? pending.proposed_lines
    : []
  const proposedCharges = Array.isArray(pending.proposed_charges)
    ? pending.proposed_charges
    : []

  const removed = proposedLines.filter((l) => l?.remove)
  const edited = proposedLines.filter((l) => !l?.remove)
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

  const money = (n: number) =>
    currencyCode ? getLocaleAmount(n, currencyCode.toLowerCase()) : `₹${n}`

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
          <Heading level="h2">{t("partner.inventoryOrders.changes.pendingTitle")}</Heading>
          <Badge size="small" color="blue">
            {t("partner.inventoryOrders.changes.awaitingApproval")}
          </Badge>
        </div>

        {edited.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              {t("partner.inventoryOrders.changes.lineChanges")}
            </Text>
            {edited.map((l: any) => {
              const original = lineById.get(l.id)
              return (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{labelFor(l.id)}</span>
                  <span className="text-ui-fg-muted">
                    {original
                      ? `${money(original.price)} × ${fmt(original.quantity)} → ${money(l.price)} × ${fmt(l.quantity)}`
                      : `${money(l.price)} × ${fmt(l.quantity)}`}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {removed.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              {t("partner.inventoryOrders.changes.removedLines")}
            </Text>
            {removed.map((l: any) => (
              <div key={l.id} className="text-sm line-through text-ui-fg-muted">
                {labelFor(l.id)}
              </div>
            ))}
          </div>
        )}

        {proposedCharges.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              {t("partner.inventoryOrders.changes.proposedTax")}
            </Text>
            {proposedCharges.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-ui-fg-muted">{c?.note || "Tax"}</span>
                <span>{money(Number(c?.amount))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{t("partner.inventoryOrders.changes.taxTotal")}</span>
              <span>{money(taxTotal)}</span>
            </div>
          </div>
        )}

        <div className="bg-ui-bg-subtle rounded-b-xl px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.inventoryOrders.changes.lockedNotice")}
          </Text>
        </div>
      </Container>
    </div>
  )
}

export default InventoryOrderChangeBanner