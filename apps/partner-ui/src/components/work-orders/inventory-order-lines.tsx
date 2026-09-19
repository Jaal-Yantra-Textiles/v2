import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

// Collapse long line lists so the work-order detail stays scannable (#887).
const COLLAPSED_LINE_COUNT = 6

import { getLocaleAmount, getStylizedAmount } from "../../lib/money-amount-helpers"
import { Thumbnail } from "../common/thumbnail"
import { lineTotal, lineUnitPrice } from "./line-money"

const fmt = (n: number) => {
  if (!Number.isFinite(n)) {
    return "0"
  }
  const s = (Math.round(n * 1000) / 1000).toFixed(3)
  return s.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1")
}

const lineFulfilled = (line: Record<string, any>): number =>
  Array.isArray(line?.line_fulfillments)
    ? line.line_fulfillments.reduce(
        (sum: number, f: any) => sum + (Number(f?.quantity_delta) || 0),
        0
      )
    : 0

/**
 * Inventory work-order line items (#342), rendered in the Medusa core order
 * line-item aesthetic (order-summary-section `Item`): a `grid-cols-2` row —
 * product info on the left, an aligned `unit-price · {qty}x · total` money
 * block on the right — with a subtle fulfillment badge so a work-order reads
 * exactly like a normal order. Lines are sorted deterministically so the list
 * never re-shuffles between fetches.
 */
export const InventoryOrderLines = ({
  orderLines,
  currencyCode,
  totalPrice,
  charges,
  payableCeiling,
}: {
  orderLines: Array<Record<string, any>>
  currencyCode?: string
  totalPrice?: number | null
  /**
   * APPLIED non-goods amounts — tax, packing, a discount. Read-only here; a
   * partner proposes a tax elsewhere and an admin decides whether it lands.
   */
  charges?: Array<Record<string, any>> | null
  /**
   * `goods + raises - lowers`, computed SERVER-SIDE by `orderPayableCeiling`.
   * Never re-derived in the browser: the same lib backs the write guard, and a
   * second implementation here is how the screen starts quoting a figure the
   * guard rejects.
   */
  payableCeiling?: number | null
}) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  /**
   * Only charges that actually moved money. A type the BACKEND did not
   * recognise arrives as `direction: 0` and is dropped rather than guessed —
   * rendering it as a raise would invent an obligation on the partner's screen.
   */
  const appliedCharges = useMemo(
    () =>
      (Array.isArray(charges) ? charges : []).filter(
        (c) => Number(c?.direction) !== 0 && Number(c?.amount)
      ),
    [charges]
  )

  const signOf = (charge: Record<string, any>) => Number(charge?.direction) || 1

  /**
   * The supplier's own note first — it names the invoice the charge came from
   * ("IGST @ 5% — GOF invoice GOF/2026-27/007") and beats any generic label.
   *
   * ⚠️ LITERAL translation keys, not an interpolated one: the key type is a
   * union of every known key, so a template string resolves to `unknown` and
   * cannot be rendered. Falls back to the raw type for anything unlisted.
   */
  const chargeLabel = (charge: Record<string, any>): string => {
    const note = String(charge?.note ?? "").trim()
    if (note) return note
    switch (String(charge?.type ?? "")) {
      case "tax":
        return t("partner.workOrders.charge.tax", "Tax")
      case "shipping":
        return t("partner.workOrders.charge.shipping", "Packing & shipping")
      case "discount":
        return t("partner.workOrders.charge.discount", "Discount")
      case "adjustment":
        return t("partner.workOrders.charge.adjustment", "Adjustment")
      default:
        return String(charge?.type ?? "")
    }
  }

  // Deterministic order: by creation time, then id — so rows don't jump around.
  const lines = useMemo(
    () =>
      [...orderLines].sort((a, b) => {
        const ta = Date.parse(a?.created_at ?? "") || 0
        const tb = Date.parse(b?.created_at ?? "") || 0
        if (ta !== tb) {
          return ta - tb
        }
        return String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
      }),
    [orderLines]
  )

  if (!lines.length) {
    return (
      <Container className="divide-y divide-dashed p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{t("partner.inventoryOrders.detail.linesHeading")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.inventoryOrders.detail.noLines")}
          </Text>
        </div>
      </Container>
    )
  }

  const cc = (currencyCode || "").toLowerCase()
  const unitMoney = (amount: number) => (cc ? getLocaleAmount(amount, cc) : fmt(amount))
  const totalMoney = (amount: number) => (cc ? getStylizedAmount(amount, cc) : fmt(amount))
  const totalRequested = lines.reduce((sum, l) => sum + (Number(l?.quantity) || 0), 0)

  const isCollapsible = lines.length > COLLAPSED_LINE_COUNT
  const visibleLines =
    isCollapsible && !expanded ? lines.slice(0, COLLAPSED_LINE_COUNT) : lines
  const hiddenCount = lines.length - COLLAPSED_LINE_COUNT

  return (
    <Container className="divide-y divide-dashed p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("partner.inventoryOrders.detail.linesHeading")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("partner.inventoryOrders.detail.linesDescription")}
        </Text>
      </div>

      {visibleLines.map((line) => {
        // #817 S2 — color identity is denormalized onto the line, so this reads
        // correctly even without the inventory_item relation loaded.
        const title =
          line?.material_name ||
          line?.inventory_items?.[0]?.title ||
          line?.inventory_items?.[0]?.name ||
          line?.inventory_item_id ||
          line?.id
        const sku = line?.inventory_items?.[0]?.sku
        const thumbnail = line?.inventory_items?.[0]?.thumbnail
        const requested = Number(line?.quantity) || 0
        const fulfilled = lineFulfilled(line)
        const remaining = Math.max(0, requested - fulfilled)
        const price = Number(line?.price) || 0
        // #1894 — extra_cost is the per-unit dye/finishing charge. The order
        // total below these rows includes it, so the rows must too.
        const extraCost = Number(line?.extra_cost) || 0
        const unitPrice = lineUnitPrice(line)
        const subtitle = [
          line?.color,
          sku ? `SKU ${sku}` : null,
          extraCost > 0 ? `${unitMoney(price)} + ${unitMoney(extraCost)} finishing` : null,
        ]
          .filter(Boolean)
          .join(" · ")

        return (
          <div
            key={String(line.id)}
            className="text-ui-fg-subtle grid grid-cols-1 items-center gap-x-4 gap-y-3 px-6 py-4 sm:grid-cols-2"
          >
            {/* Left: product info — thumbnail + title/subtitle + fulfilment badge */}
            <div className="flex items-start gap-x-4">
              <Thumbnail src={thumbnail} alt={String(title)} />
              <div className="flex min-w-0 flex-col gap-y-1">
                <Text
                  size="small"
                  leading="compact"
                  weight="plus"
                  className="text-ui-fg-base truncate"
                  title={String(title)}
                >
                  {String(title)}
                </Text>
                {subtitle && (
                  <Text size="small" leading="compact" className="text-ui-fg-subtle truncate">
                    {subtitle}
                  </Text>
                )}
                <div className="flex items-center gap-x-1.5 pt-0.5">
                  <Badge size="2xsmall" color={remaining === 0 ? "green" : "orange"}>
                    {remaining === 0
                      ? t("partner.inventoryOrders.detail.columns.fulfilled")
                      : `${fmt(remaining)} ${t("partner.inventoryOrders.detail.columns.remaining")}`}
                  </Badge>
                  {fulfilled > 0 && remaining > 0 && (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {fmt(fulfilled)}/{fmt(requested)}
                    </Text>
                  )}
                </div>
              </div>
            </div>

            {/* Right: money block — mirrors core "unit  {qty}x  total" grid */}
            <div className="grid grid-cols-3 items-center gap-x-4">
              <div className="flex items-center justify-end">
                <Text size="small">{unitPrice > 0 ? unitMoney(unitPrice) : "—"}</Text>
              </div>
              <div className="flex items-center justify-end">
                <Text size="small">
                  <span className="tabular-nums">{fmt(requested)}</span>x
                </Text>
              </div>
              <div className="flex items-center justify-end">
                <Text size="small" weight="plus" className="text-ui-fg-base text-nowrap">
                  {unitPrice > 0 ? totalMoney(lineTotal(line, requested)) : "—"}
                </Text>
              </div>
            </div>
          </div>
        )
      })}

      {isCollapsible && (
        <div className="px-6 py-3">
          <Button
            variant="transparent"
            size="small"
            className="text-ui-fg-subtle w-full justify-center"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded
              ? t("actions.showLess")
              : `${t("actions.showMore")} (${hiddenCount})`}
          </Button>
        </div>
      )}

      {/* Total footer — the retail order-summary money block */}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <div className="text-ui-fg-subtle flex items-center justify-between">
          <Text size="small">{t("partner.workOrders.totalQuantity")}</Text>
          <Text size="small">{fmt(totalRequested)}</Text>
        </div>
        {totalPrice != null && (
          <div className="flex items-center justify-between">
            <Text size="small" weight={appliedCharges.length ? undefined : "plus"}>
              {appliedCharges.length
                ? t("partner.workOrders.goodsTotal", "Goods")
                : t("partner.workOrders.total")}
            </Text>
            <Text size="small" weight={appliedCharges.length ? undefined : "plus"}>
              {totalMoney(Number(totalPrice))}
            </Text>
          </div>
        )}

        {/*
          #1737 — the applied charges, one row each. This surface was
          write-only: a partner could propose a tax and never see what was
          applied, because the figure only ever rendered in the pending-change
          banner and vanished on approval.
        */}
        {appliedCharges.map((charge) => (
          <div
            key={String(charge?.id)}
            className="text-ui-fg-subtle flex items-center justify-between"
          >
            <Text size="small">
              {chargeLabel(charge)}
            </Text>
            <Text size="small">
              {signOf(charge) < 0 ? "-" : ""}
              {totalMoney(Math.abs(Number(charge?.amount) || 0))}
            </Text>
          </div>
        ))}

        {payableCeiling != null && appliedCharges.length > 0 && (
          <div className="border-ui-border-base flex items-center justify-between border-t pt-2">
            <Text size="small" weight="plus">
              {t("partner.workOrders.payableCeiling", "Payable ceiling")}
            </Text>
            <Text size="small" weight="plus">
              {totalMoney(Number(payableCeiling))}
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}
