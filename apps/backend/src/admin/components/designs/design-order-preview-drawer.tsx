import { useState, useMemo, useEffect } from "react"
import {
  Drawer,
  Button,
  Text,
  Heading,
  Badge,
  Input,
  Label,
  Select,
} from "@medusajs/ui"
import type { DesignEstimatePreview } from "../../hooks/api/designs"
import {
  canCreateOrder,
  hydrateEstimates,
  money,
  summariseEdits,
  type EditableEstimate,
} from "./design-order-preview-lib"

const confidenceColor = (c: string): "green" | "orange" | "red" | "blue" => {
  switch (c) {
    case "exact": return "green"
    case "estimated": return "orange"
    case "manual": return "blue"
    default: return "red"
  }
}

const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount)
}

const CURRENCY_OPTIONS = [
  { value: "inr", label: "INR (₹)" },
  { value: "eur", label: "EUR (€)" },
  { value: "usd", label: "USD ($)" },
  { value: "gbp", label: "GBP (£)" },
  { value: "aud", label: "AUD (A$)" },
]

type DesignOrderPreviewDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  estimates: DesignEstimatePreview[]
  currencyCode: string
  total: number
  onConfirm: (priceOverrides: Record<string, number>, overrideCurrency?: string) => void
  isConfirming: boolean
}

export const DesignOrderPreviewDrawer = ({
  open,
  onOpenChange,
  estimates,
  currencyCode,
  total,
  onConfirm,
  isConfirming,
}: DesignOrderPreviewDrawerProps) => {
  const [edited, setEdited] = useState<Record<string, EditableEstimate>>({})
  const [overrideCurrency, setOverrideCurrency] = useState<string>("inr")

  /**
   * 🔴 `null` is a real answer and must never reach `.toFixed()`. It used to,
   * and the drawer died with `null is not an object` before rendering — see
   * `design-order-preview-lib` for what that cost. The rules live there so they
   * can be tested; this only wires them up.
   */
  useEffect(() => {
    setEdited(hydrateEstimates(estimates))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimates])

  const updateField = (
    designId: string,
    field: keyof EditableEstimate,
    value: string
  ) => {
    setEdited((prev) => {
      const current = prev[designId]
      if (!current) return prev

      const next = { ...current, [field]: value }

      // Auto-compute unit price when material or production changes
      if (field === "material" || field === "production") {
        const mat = parseFloat(field === "material" ? value : next.material) || 0
        const prod = parseFloat(field === "production" ? value : next.production) || 0
        next.unitPrice = money(mat + prod)
      }

      return { ...prev, [designId]: next }
    })
  }

  const { priceOverrides, computedTotal, hasChanges, unpriced } = useMemo(
    () => summariseEdits(estimates, edited),
    [edited, estimates]
  )

  const handleConfirm = () => {
    onConfirm(priceOverrides, hasChanges ? overrideCurrency : undefined)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content className="max-w-lg">
        <Drawer.Header>
          <Drawer.Title>Draft Order Preview</Drawer.Title>
          <Drawer.Description>
            Review and adjust estimated costs before creating the order.
          </Drawer.Description>
        </Drawer.Header>

        <Drawer.Body className="overflow-y-auto">
          {hasChanges && (
            <div className="mb-4 p-3 rounded-lg border border-ui-border-base bg-ui-bg-subtle">
              <Label size="xsmall" className="mb-1.5">Prices entered in</Label>
              <Select size="small" value={overrideCurrency} onValueChange={setOverrideCurrency}>
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {CURRENCY_OPTIONS.map((opt) => (
                    <Select.Item key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                The system will convert to the cart currency if different.
              </Text>
            </div>
          )}

          <div className="space-y-4">
            {estimates.map((est) => {
              const entry = edited[est.design_id]
              if (!entry) return null

              /**
               * A blank field is "not answered yet", not 0 — so an untouched
               * unpriceable line does not claim to have been "manual"ly priced.
               */
              const typedPrice =
                entry.unitPrice.trim() === "" ? null : parseFloat(entry.unitPrice)
              const isModified =
                typedPrice != null &&
                Number.isFinite(typedPrice) &&
                typedPrice !== est.unit_price

              return (
                <div
                  key={est.design_id}
                  className="border border-ui-border-base rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <Text size="small" weight="plus">{est.name}</Text>
                    <Badge size="2xsmall" color={isModified ? "blue" : confidenceColor(est.confidence)}>
                      {isModified ? "manual" : est.confidence}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label size="xsmall" className="mb-1">Material</Label>
                      <Input
                        type="number"
                        size="small"
                        step="0.01"
                        min="0"
                        value={entry.material}
                        onChange={(e) => updateField(est.design_id, "material", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label size="xsmall" className="mb-1">Production</Label>
                      <Input
                        type="number"
                        size="small"
                        step="0.01"
                        min="0"
                        value={entry.production}
                        onChange={(e) => updateField(est.design_id, "production", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label size="xsmall" className="mb-1">Unit Price</Label>
                      <Input
                        type="number"
                        size="small"
                        step="0.01"
                        min="0"
                        value={entry.unitPrice}
                        onChange={(e) => updateField(est.design_id, "unitPrice", e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Stops describing the estimate once the operator has answered it. */}
                  {est.unit_price == null && !isModified && (
                    <Text size="xsmall" className="text-ui-fg-error mt-2">
                      Not priced — this design has no bill of materials and no
                      cost history, so nothing could be estimated from. Enter a
                      unit price.
                    </Text>
                  )}

                  {est.unit_price === 0 && !isModified && (
                    <Text size="xsmall" className="text-ui-fg-error mt-2">
                      Estimated cost is zero — please enter a price.
                    </Text>
                  )}
                </div>
              )
            })}
          </div>

          {/*
            Say what is still missing, in the footer's own words. The per-row
            message is easy to scroll past on a batch, and the disabled Create
            button says nothing about WHY on its own.
          */}
          {unpriced.length > 0 && (
            <Text size="xsmall" className="text-ui-fg-error mt-4">
              {unpriced.length === 1
                ? "1 design still needs a unit price."
                : `${unpriced.length} designs still need a unit price.`}{" "}
              An order cannot be created until every line has one — a blank line
              is not a free one.
            </Text>
          )}

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-ui-border-base">
            <Heading level="h3">Order Total</Heading>
            <Heading level="h3">{formatCurrency(computedTotal, currencyCode)}</Heading>
          </div>

          {/*
            🔑 Only when there WAS one. The server's total covers priced lines
            only, so on a batch of unpriceable designs it is 0 — and
            "Original estimate: ₹0.00" reads as "we estimated it at nothing"
            rather than "nothing could be estimated".
          */}
          {hasChanges && total > 0 && (
            <Text size="xsmall" className="text-ui-fg-subtle mt-1">
              Original estimate: {formatCurrency(total, currencyCode)}
            </Text>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </Drawer.Close>
          {/*
            🔑 Refused while ANY line is unpriced, not merely while the total is
            zero. The old gate let a batch through with one priced design and
            one blank — and the workflow then threw on the blank, after the
            click, naming a design the operator could no longer see.
          */}
          <Button
            size="small"
            onClick={handleConfirm}
            isLoading={isConfirming}
            disabled={
              !canCreateOrder({ priceOverrides, computedTotal, hasChanges, unpriced })
            }
          >
            Create Draft Order
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
