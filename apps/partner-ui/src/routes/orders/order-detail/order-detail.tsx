import { useQueryClient } from "@tanstack/react-query"
import { useLoaderData, useParams } from "react-router-dom"

import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { TwoColumnPage } from "../../../components/layout/pages"
import { InventoryOrderLines } from "../../../components/work-orders/inventory-order-lines"
import {
  InventoryFulfillmentsSection,
  InventoryPaymentsSection,
} from "../../../components/work-orders/inventory-order-sections"
import { ProductionRunCard } from "../../../components/work-orders/production-run-card"
import { ordersQueryKeys, useOrder, useOrderPreview } from "../../../hooks/api/orders"
import { usePartnerConsumptionLogs } from "../../../hooks/api/partner-consumption-logs"
import { usePartnerDesign } from "../../../hooks/api/partner-designs"
import { usePartnerInventoryOrder } from "../../../hooks/api/partner-inventory-orders"
import { usePartnerProductionRun } from "../../../hooks/api/partner-production-runs"
import { usePlugins } from "../../../hooks/api/plugins"
import { useExtension } from "../../../providers/extension-provider"
import { ActiveOrderClaimSection } from "./components/active-order-claim-section"
import { ActiveOrderExchangeSection } from "./components/active-order-exchange-section"
import { ActiveOrderReturnSection } from "./components/active-order-return-section"
import { OrderActiveEditSection } from "./components/order-active-edit-section"
import { OrderActivitySection } from "./components/order-activity-section"
import { OrderCustomerSection } from "./components/order-customer-section"
import { OrderFulfillmentSection } from "./components/order-fulfillment-section"
import { OrderGeneralSection } from "./components/order-general-section"
import { OrderPaymentSection } from "./components/order-payment-section"
import { OrderSummarySection } from "./components/order-summary-section"
import { WorkOrderStatusSection } from "./components/work-order-status-section"
import { DEFAULT_FIELDS } from "./constants"
import { orderLoader } from "./loader"
import { useOrderKind } from "./use-order-kind"

export const OrderDetail = () => {
  const initialData = useLoaderData() as Awaited<ReturnType<typeof orderLoader>>

  const { id } = useParams()
  const queryClient = useQueryClient()
  const { getWidgets } = useExtension()
  const { plugins = [] } = usePlugins()

  const { order, isLoading, isError, error } = useOrder(
    id!,
    {
      fields: DEFAULT_FIELDS,
    },
    {
      initialData,
    }
  )

  // TODO: Retrieve endpoints don't have an order ability, so a JS sort until this is available
  if (order) {
    order.items = order.items.sort((itemA, itemB) => {
      if (itemA.created_at > itemB.created_at) {
        return 1
      }

      if (itemA.created_at < itemB.created_at) {
        return -1
      }

      return 0
    })
  }

  const { order: orderPreview, isLoading: isPreviewLoading } = useOrderPreview(
    id!
  )

  // #342 — a unified order can be a design/inventory work-order. Derive the
  // kind from the reverse execution links the detail route attaches, then fold
  // in the work-specific surfaces (run card / inventory lines + actions) and
  // hide the retail-only sections (edit/returns/exchanges/claims/payment/
  // fulfillment/customer) — work-orders are customer-less.
  const { kind, legacyId, isWorkOrder } = useOrderKind(order)

  // Design work-order: legacy_id is the production_run id → resolve the run,
  // then the design (for the Complete materials form, name, cost currency).
  const { production_run } = usePartnerProductionRun(legacyId ?? "", {
    enabled: kind === "design" && !!legacyId,
  })
  const designId = (production_run as any)?.design_id as string | undefined
  const { design } = usePartnerDesign(designId ?? "", { enabled: !!designId })
  const { logs: consumptionLogs = [], count: consumptionCount = 0 } =
    usePartnerConsumptionLogs(designId ?? "", undefined, { enabled: !!designId })

  // Inventory work-order: legacy_id is the inventory_order id.
  const { inventoryOrder } = usePartnerInventoryOrder(legacyId ?? "", {
    enabled: kind === "inventory" && !!legacyId,
  })

  const invalidateOrder = () =>
    queryClient.invalidateQueries({ queryKey: ordersQueryKeys.detail(id!) })

  if (isLoading || !order) {
    return (
      <TwoColumnPageSkeleton mainSections={4} sidebarSections={2} showJSON />
    )
  }

  if (isError) {
    throw error
  }

  // Retail order preview drives the active claim/exchange/return sections; work
  // orders don't use it, so don't block their render on the preview fetch.
  if (!isWorkOrder && isPreviewLoading) {
    return (
      <TwoColumnPageSkeleton mainSections={4} sidebarSections={2} showJSON />
    )
  }

  return (
    <TwoColumnPage
      widgets={{
        after: getWidgets("order.details.after"),
        before: getWidgets("order.details.before"),
        sideAfter: getWidgets("order.details.side.after"),
        sideBefore: getWidgets("order.details.side.before"),
      }}
      data={order}
      showJSON
      showMetadata
      hasOutlet
    >
      <TwoColumnPage.Main>
        {!isWorkOrder && (
          <>
            <OrderActiveEditSection order={order} />
            <ActiveOrderClaimSection orderPreview={orderPreview!} />
            <ActiveOrderExchangeSection orderPreview={orderPreview!} />
            <ActiveOrderReturnSection orderPreview={orderPreview!} />
            <OrderGeneralSection order={order} />
            <OrderSummarySection order={order} plugins={plugins} />
            <OrderPaymentSection order={order} plugins={plugins} />
            <OrderFulfillmentSection order={order} />
          </>
        )}
        {isWorkOrder && (
          <>
            <WorkOrderStatusSection
              order={order}
              kind={kind}
              designId={designId}
              productionRun={production_run}
              inventoryOrder={inventoryOrder}
            />
            {kind === "design" && production_run && design && (
              <ProductionRunCard
                run={production_run}
                design={design}
                consumptionLogs={consumptionLogs}
                consumptionCount={consumptionCount}
                onActionSuccess={invalidateOrder}
              />
            )}
            {kind === "inventory" && inventoryOrder && (
              <>
                <InventoryOrderLines
                  orderLines={(inventoryOrder.order_lines ?? []) as Array<Record<string, any>>}
                  currencyCode={(order as any).currency_code}
                  totalPrice={(inventoryOrder as any).total_price}
                />
                <InventoryPaymentsSection
                  payments={((inventoryOrder as any).payments ?? []) as Array<Record<string, any>>}
                  currencyCode={(order as any).currency_code}
                />
                <InventoryFulfillmentsSection
                  orderLines={(inventoryOrder.order_lines ?? []) as Array<Record<string, any>>}
                />
              </>
            )}
          </>
        )}
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        {!isWorkOrder && <OrderCustomerSection order={order} />}
        <OrderActivitySection order={order} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
