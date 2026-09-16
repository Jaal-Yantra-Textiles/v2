import { Heading, Skeleton, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { DesignOrderRepriceForm } from "../../../../components/designs/design-order-reprice-form"
import { useDesignOrder } from "../../../../hooks/api/design-orders"

/**
 * /app/design-orders/:id/reprice — the price on an existing design order line.
 *
 * Re-read here rather than handed down, so the drawer is correct when opened
 * directly by URL or after a refresh. Shares the detail page's query key, so
 * this is the cache rather than a second round trip. #1970 PR5
 */
export default function DesignOrderRepricePage() {
  const { id } = useParams()
  const { designOrder, isLoading, error } = useDesignOrder(id || "", {
    enabled: !!id,
  })

  if (isLoading || !designOrder) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Skeleton className="h-6 w-40" />
        </RouteDrawer.Header>
        <div className="flex flex-1 flex-col gap-y-6 overflow-y-auto px-6 py-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </RouteDrawer>
    )
  }

  if (error) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading>Error</Heading>
        </RouteDrawer.Header>
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-subtle">
            {error.message}
          </Text>
        </div>
      </RouteDrawer>
    )
  }

  const order = designOrder as any

  return (
    <RouteDrawer>
      {/* Title, not a bare Heading — Radix refuses a DialogContent with no
          DialogTitle as accessible and logs it on every open. */}
      <RouteDrawer.Header>
        <div className="flex flex-col gap-y-0.5">
          <RouteDrawer.Title asChild>
            <Heading>Reprice</Heading>
          </RouteDrawer.Title>
          <Text size="xsmall" className="text-ui-fg-subtle">
            What the buyer pays for this design
          </Text>
        </div>
      </RouteDrawer.Header>
      <DesignOrderRepriceForm
        lineItemId={id!}
        currentPrice={order.price ?? null}
        currencyCode={order.currency_code || order.order?.currency_code || "inr"}
        title={order.title || order.design?.name || "This design"}
      />
    </RouteDrawer>
  )
}
