import { useState, useMemo, useEffect } from "react"
import {
  Drawer,
  Button,
  Text,
  Heading,
  Badge,
  Input,
  Label,
} from "@medusajs/ui"
import type { DesignEstimatePreview } from "../../hooks/api/designs"

const confidenceColor = (c: string): "green" | "orange" | "red" | "blue" => {
  switch (c) {
    case "exact": return "green"
    case "estimated": return "orange"
    case "manual": return "blue"
    default: return "red"
  }
}

const formatCurrency = (amountInCents: number, currency: string) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amountInCents / 100)
}

type EditableEstimate = {
  material: string
  production: string
  unitPrice: string
}

type DesignOrderPreviewDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  estimates: DesignEstimatePreview[]
  currencyCode: string
  total: number
  onConfirm: (priceOverrides: Record<string, number>) => void
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

  // Initialize from estimates
  useEffect(() => {
    const initial: Record<string, EditableEstimate> = {}
    for (const est of estimates) {
      initial[est.design_id] = {
        material: est.material_cost.toFixed(2),
        production: est.production_cost.toFixed(2),
        unitPrice: (est.unit_price / 100).toFixed(2),
      }
    }
    setEdited(initial)
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
        next.unitPrice = (mat + prod).toFixed(2)
      }

      return { ...prev, [designId]: next }
    })
  }

  const { priceOverrides, computedTotal, hasChanges } = useMemo(() => {
    const overrides: Record<string, number> = {}
    let newTotal = 0
    let changed = false

    for (const est of estimates) {
      const entry = edited[est.design_id]
      const editedCents = Math.round(parseFloat(entry?.unitPrice || "0") * 100)
      newTotal += editedCents

      if (editedCents !== est.unit_price) {
        overrides[est.design_id] = editedCents
        changed = true
      }
    }

    return { priceOverrides: overrides, computedTotal: newTotal, hasChanges: changed }
  }, [edited, estimates])

  const handleConfirm = () => {
    onConfirm(priceOverrides)
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
          <div className="space-y-4">
            {estimates.map((est) => {
              const entry = edited[est.design_id]
              if (!entry) return null

              const editedCents = Math.round(parseFloat(entry.unitPrice || "0") * 100)
              const isModified = editedCents !== est.unit_price

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

                  {est.unit_price === 0 && !isModified && (
                    <Text size="xsmall" className="text-ui-fg-error mt-2">
                      Estimated cost is zero — please enter a price.
                    </Text>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-ui-border-base">
            <Heading level="h3">Order Total</Heading>
            <Heading level="h3">{formatCurrency(computedTotal, currencyCode)}</Heading>
          </div>

          {hasChanges && (
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
          <Button
            size="small"
            onClick={handleConfirm}
            isLoading={isConfirming}
            disabled={computedTotal === 0}
          >
            Create Draft Order
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
