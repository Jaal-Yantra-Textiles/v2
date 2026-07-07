import { useEffect, useRef, useState } from "react"
import { ArrowPath } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"

import { SectionRow } from "../../../../components/common/section"
import { Skeleton } from "../../../../components/common/skeleton"
import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import {
  usePartnerDesignCost,
  useRecalculatePartnerDesignCost,
} from "../../../../hooks/api/partner-design-cost"

type Props = { design: PartnerDesign }

const fmt = (v?: number | null, currency?: string | null) =>
  v == null
    ? "—"
    : `${currency ? currency.toUpperCase() + " " : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

/**
 * Roadmap #6 Phase 3 — cost panel. Shows the design's estimated / material /
 * production cost + the 10% JYT platform fee, with a Recalculate action (owner
 * only) that re-runs the estimate over the linked BOM. The owner can also type
 * their own production cost, which overrides the auto estimate.
 */
export const DesignCostSection = ({ design }: Props) => {
  const isOwner = !!(design as any).owner_partner_id
  const { cost, isLoading } = usePartnerDesignCost(design.id)
  const { mutateAsync: recalc, isPending } = useRecalculatePartnerDesignCost(
    design.id
  )

  // Partner-entered production cost per unit. Seed from the persisted value once
  // it loads; `touched` keeps a later refetch from clobbering the owner's typing.
  const [prodInput, setProdInput] = useState("")
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current && cost?.production_cost != null) {
      setProdInput(String(cost.production_cost))
    }
  }, [cost?.production_cost])

  const handleRecalc = async () => {
    const trimmed = prodInput.trim()
    let production_cost: number | undefined
    if (trimmed !== "") {
      const n = Number(trimmed)
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Enter a valid production cost (0 or more)")
        return
      }
      production_cost = n
    }
    await recalc(
      { production_cost },
      {
        onSuccess: (d) => {
          touched.current = false
          toast.success(
            `Cost recalculated: ${fmt(d.cost_estimate.total_estimated)} (${d.cost_estimate.confidence})`
          )
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  const currency = cost?.cost_currency
  const confidence = cost?.cost_breakdown?.confidence
  const feePercent = cost?.cost_breakdown?.platform_fee_percent ?? 10
  const prodIsPartnerEntered =
    cost?.cost_breakdown?.production_cost_source === "partner_entered"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Cost estimate</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Material + production cost from the linked BOM, plus the JYT platform
            fee.
          </Text>
        </div>
        {isOwner && (
          <Button
            size="small"
            variant="secondary"
            isLoading={isPending}
            onClick={handleRecalc}
          >
            <ArrowPath />
            Recalculate
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col divide-y">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-6 py-4"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <SectionRow
            title="Estimated total"
            value={
              <div className="flex items-center gap-x-2">
                <Text size="small" weight="plus">
                  {fmt(cost?.estimated_cost, currency)}
                </Text>
                {confidence && (
                  <Badge
                    size="2xsmall"
                    color={
                      confidence === "exact"
                        ? "green"
                        : confidence === "estimated"
                          ? "blue"
                          : "orange"
                    }
                  >
                    {confidence}
                  </Badge>
                )}
              </div>
            }
          />
          <SectionRow
            title="Material cost"
            value={fmt(cost?.material_cost, currency)}
          />
          <SectionRow
            title="Production cost"
            value={
              <div className="flex items-center gap-x-2">
                <Text size="small">{fmt(cost?.production_cost, currency)}</Text>
                <Badge size="2xsmall" color={prodIsPartnerEntered ? "green" : "grey"}>
                  {prodIsPartnerEntered ? "your input" : "estimated"}
                </Badge>
              </div>
            }
          />
          <SectionRow
            title={`Platform fee (${feePercent}%)`}
            value={fmt(cost?.platform_fee, currency)}
          />
          {cost?.cost_breakdown?.calculated_at && (
            <SectionRow
              title="Last calculated"
              value={new Date(cost.cost_breakdown.calculated_at).toLocaleString()}
            />
          )}

          {isOwner && (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              <Label size="small" weight="plus" htmlFor="partner-production-cost">
                Your production cost (per unit)
              </Label>
              <div className="flex items-center gap-x-2">
                <Input
                  id="partner-production-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Auto-estimate"
                  value={prodInput}
                  onChange={(e) => {
                    touched.current = true
                    setProdInput(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRecalc()
                  }}
                  className="max-w-[220px]"
                />
                {prodInput.trim() !== "" && (
                  <Button
                    size="small"
                    variant="transparent"
                    type="button"
                    onClick={() => {
                      touched.current = true
                      setProdInput("")
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Overrides the auto estimate — leave blank to estimate from
                history. A {feePercent}% platform fee applies on material cost.
                Press Recalculate to apply.
              </Text>
            </div>
          )}

          {!cost?.estimated_cost && isOwner && (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                No estimate yet — add materials to the BOM, then Recalculate.
              </Text>
            </div>
          )}
        </>
      )}
    </Container>
  )
}
