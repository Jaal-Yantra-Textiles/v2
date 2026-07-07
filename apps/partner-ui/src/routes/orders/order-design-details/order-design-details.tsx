import { Container, Heading, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { SingleColumnPage } from "../../../components/layout/pages"
import { useOrder } from "../../../hooks/api/orders"
import { usePartnerProductionRun } from "../../../hooks/api/partner-production-runs"
import { DesignDetail } from "../../designs/design-detail/design-detail"

/**
 * #342 / #2 — the design manager as a sub-route of the unified order
 * (`/orders/:id/design-details[/:designId]`). Instead of a reduced read-only
 * view with an "Open design manager" button that jumped to `/designs/:id`
 * (leaving the Orders context), this resolves the design id and renders the
 * FULL design manager INLINE, with a "Back to order" link — so the partner
 * drives the whole design from within the order and can return with one click.
 *
 * Resolution: a collated order's per-design route names the design directly via
 * `:designId`; a legacy single-design order resolves it from the order's
 * `metadata.legacy_id` production run. The full manager renders its own loading
 * skeleton + not-found once the id is known.
 */
export const OrderDesignDetails = () => {
  const { t } = useTranslation()
  const { id, designId: designIdParam } = useParams()

  const { order } = useOrder(id!, { fields: "id,metadata" })
  const runId = order?.metadata?.legacy_id as string | undefined
  const { production_run } = usePartnerProductionRun(runId ?? "", {
    enabled: !designIdParam && !!runId,
  })
  const designId =
    designIdParam ?? ((production_run as any)?.design_id as string | undefined)

  // Wait for the order (and, for legacy single-design orders, the run) before
  // we can name the design — the manager itself skeletons the design fetch.
  if (!order || (!designIdParam && runId && !production_run)) {
    return (
      <TwoColumnPageSkeleton mainSections={5} sidebarSections={3} showJSON={false} />
    )
  }

  if (!designId) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>{t("partner.workOrders.designDetails")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.workOrders.noDesign")}
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  return (
    <DesignDetail
      designId={designId}
      backTo={{
        to: `/orders/${id}`,
        label: t("partner.workOrders.backToOrder", "Back to order"),
      }}
    />
  )
}
