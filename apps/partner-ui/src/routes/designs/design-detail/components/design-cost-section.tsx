import { ArrowPath } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
} from "@medusajs/ui"

import { SectionRow } from "../../../../components/common/section"
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
 * Roadmap #6 Phase 3 — cost panel. Shows the design's estimated /
 * material / production cost + breakdown, with a Recalculate action
 * (owner only) that re-runs the estimate over the linked BOM.
 */
export const DesignCostSection = ({ design }: Props) => {
  const isOwner = !!(design as any).owner_partner_id
  const { cost, isLoading } = usePartnerDesignCost(design.id)
  const { mutateAsync: recalc, isPending } = useRecalculatePartnerDesignCost(
    design.id
  )

  const handleRecalc = async () => {
    await recalc(undefined, {
      onSuccess: (d) =>
        toast.success(
          `Cost recalculated: ${fmt(d.cost_estimate.total_estimated)} (${d.cost_estimate.confidence})`
        ),
      onError: (e) => toast.error(e.message),
    })
  }

  const currency = cost?.cost_currency
  const confidence = cost?.cost_breakdown?.confidence

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Cost estimate</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Material + production cost from the linked BOM.
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
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
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
            value={fmt(cost?.production_cost, currency)}
          />
          {cost?.cost_breakdown?.calculated_at && (
            <SectionRow
              title="Last calculated"
              value={new Date(cost.cost_breakdown.calculated_at).toLocaleString()}
            />
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
