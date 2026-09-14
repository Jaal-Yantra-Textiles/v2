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
import { useTranslation } from "react-i18next"

import { SectionRow } from "../../../../components/common/section"
import { Skeleton } from "../../../../components/common/skeleton"
import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import {
  usePartnerDesignCost,
  useRecalculatePartnerDesignCost,
} from "../../../../hooks/api/partner-design-cost"
import { useDate } from "../../../../hooks/use-date"
import { confidenceLabel } from "../../../../lib/design-labels"

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
  const { t } = useTranslation()
  const { getFullDate } = useDate()
  const isOwner = !!design.is_owner
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
        toast.error(t("partner.designs.cost.enterValid"))
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
            t("partner.designs.cost.recalculated", {
              amount: fmt(d.cost_estimate.total_estimated),
              confidence: d.cost_estimate.confidence,
            })
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
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading level="h2">{t("partner.designs.cost.heading")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.designs.cost.subtitle")}
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
            {t("partner.designs.cost.recalculate")}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col divide-y">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <SectionRow
            title={t("partner.designs.cost.estimatedTotal")}
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
                    {confidenceLabel(t, confidence)}
                  </Badge>
                )}
              </div>
            }
          />
          <SectionRow
            title={t("partner.designs.cost.materialCost")}
            value={fmt(cost?.material_cost, currency)}
          />
          <SectionRow
            title={t("partner.designs.cost.productionCost")}
            value={
              <div className="flex items-center gap-x-2">
                <Text size="small">{fmt(cost?.production_cost, currency)}</Text>
                <Badge size="2xsmall" color={prodIsPartnerEntered ? "green" : "grey"}>
                  {prodIsPartnerEntered
                    ? t("partner.designs.cost.yourInput")
                    : t("partner.designs.cost.estimatedLabel")}
                </Badge>
              </div>
            }
          />
          <SectionRow
            title={t("partner.designs.cost.platformFee", { percent: feePercent })}
            value={fmt(cost?.platform_fee, currency)}
          />
          {cost?.cost_breakdown?.calculated_at && (
            <SectionRow
              title={t("partner.designs.cost.lastCalculated")}
              value={getFullDate({ date: cost.cost_breakdown.calculated_at, includeTime: true })}
            />
          )}

          {isOwner && (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              <Label size="small" weight="plus" htmlFor="partner-production-cost">
                {t("partner.designs.cost.yourProductionCost")}
              </Label>
              <div className="flex items-center gap-x-2">
                <Input
                  id="partner-production-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder={t("partner.designs.cost.autoEstimate")}
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
                    {t("actions.clear")}
                  </Button>
                )}
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t("partner.designs.cost.helper", { percent: feePercent })}
              </Text>
            </div>
          )}

          {!cost?.estimated_cost && isOwner && (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {t("partner.designs.cost.noEstimate")}
              </Text>
            </div>
          )}
        </>
      )}
    </Container>
  )
}