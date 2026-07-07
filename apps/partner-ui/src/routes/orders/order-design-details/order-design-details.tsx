import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { Link, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { SectionRow } from "../../../components/common/section"
import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { SingleColumnPage, TwoColumnPage } from "../../../components/layout/pages"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import { useOrder } from "../../../hooks/api/orders"
import { usePartnerDesign } from "../../../hooks/api/partner-designs"
import { usePartnerProductionRun } from "../../../hooks/api/partner-production-runs"
import { DesignCostSection } from "../../designs/design-detail/components/design-cost-section"
import { DesignConsumptionLogsSection } from "../../designs/design-detail/components/design-consumption-logs-section"
import { DesignMediaSection } from "../../designs/design-detail/components/design-media-section"
import { DesignMoodboardSection } from "../../designs/design-detail/components/design-moodboard-section"

/**
 * #342 — design details as a sub-route of the unified order
 * (`/orders/:id/design-details`, breadcrumb "Orders › <id> › Design details").
 * Resolves the design from the order's production run and renders the read-only
 * design context (general, materials, cost, consumption) inline — keeping the
 * partner in the Orders context. Editing / media / moodboard stay on the full
 * design-management surface, reachable via the header link.
 */
export const OrderDesignDetails = () => {
  const { t } = useTranslation()
  const { id, designId: designIdParam } = useParams()

  const { order } = useOrder(id!, { fields: "id,metadata" })
  // #826 — a collated order links each card to `/design-details/:designId`, so
  // the param names the design directly. Only fall back to the order's single
  // legacy_id run pointer (legacy single-design orders) when no param is given.
  const runId = order?.metadata?.legacy_id as string | undefined
  const { production_run } = usePartnerProductionRun(runId ?? "", {
    enabled: !designIdParam && !!runId,
  })
  const designId =
    designIdParam ?? ((production_run as any)?.design_id as string | undefined)
  const { design, isPending } = usePartnerDesign(designId ?? "", {
    enabled: !!designId,
  })

  if (
    !order ||
    (!designIdParam && runId && !production_run) ||
    (designId && isPending)
  ) {
    return <TwoColumnPageSkeleton mainSections={3} sidebarSections={1} showJSON={false} />
  }

  if (!design) {
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

  const materials = (design.inventory_items || []) as Array<Record<string, any>>

  return (
    // hasOutlet renders the nested media / moodboard upload modals.
    <TwoColumnPage
      widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }}
      hasOutlet
    >
      <TwoColumnPage.Main>
        {/* General + link to the full design-management surface */}
        <Container className="divide-y p-0">
          <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Heading level="h2">{design.name || t("partner.workOrders.designDetails")}</Heading>
            <Button size="small" variant="secondary" asChild>
              <Link to={`/designs/${design.id}`}>
                {t("partner.workOrders.openDesignManager")}
                <ArrowUpRightOnBox />
              </Link>
            </Button>
          </div>
          {(design as any).design_type && (
            <SectionRow
              title={t("partner.workOrders.type")}
              value={<Badge size="2xsmall" color="blue">{String((design as any).design_type)}</Badge>}
            />
          )}
          {design.status && (
            <SectionRow
              title={t("partner.workOrders.designStatus")}
              value={
                <Badge size="2xsmall" color={getStatusBadgeColor(design.status)}>
                  {String(design.status)}
                </Badge>
              }
            />
          )}
          {(design as any).description && (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
                {String((design as any).description)}
              </Text>
            </div>
          )}
        </Container>

        <DesignCostSection design={design} />
        <DesignConsumptionLogsSection design={design} />
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        {/* Media + moodboard upload — links resolve to the nested
            /orders/:id/design-details/{media,moodboard} routes. */}
        <DesignMediaSection design={design} />
        <DesignMoodboardSection design={design} />

        {/* Read-only materials list (link-free; full BOM editing is on the design manager). */}
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">{t("partner.workOrders.materials")}</Heading>
          </div>
          {materials.length === 0 ? (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {t("partner.inventoryOrders.detail.noLines")}
              </Text>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-2 py-2">
              {materials.map((it) => (
                <div
                  key={String(it.id)}
                  className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2"
                >
                  <Text size="small" weight="plus" className="truncate">
                    {String(it.title || it.name || it.sku || it.id)}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </Container>
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
