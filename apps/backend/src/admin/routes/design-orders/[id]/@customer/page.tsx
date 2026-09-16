import { Heading, Skeleton, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { DesignOrderCustomerForm } from "../../../../components/designs/design-order-customer-form"
import { useDesignOrder } from "../../../../hooks/api/design-orders"

/**
 * /app/design-orders/:id/customer — the buyer on an existing design order.
 *
 * The design order is re-read here rather than handed down from the detail
 * page, so the drawer is correct when it is opened directly by URL or after a
 * refresh. It shares the detail page's query key, so this is the cache, not a
 * second round trip. #1970 PR5
 */
export default function DesignOrderCustomerPage() {
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

  return (
    <RouteDrawer>
      {/*
        RouteDrawer.Title, not a bare Heading. Radix refuses to treat a
        DialogContent without a DialogTitle as accessible and logs it on every
        open — a screen reader then announces the drawer with no name.
      */}
      <RouteDrawer.Header>
        <div className="flex flex-col gap-y-0.5">
          <RouteDrawer.Title asChild>
            <Heading>Buyer</Heading>
          </RouteDrawer.Title>
          {/*
            Plain Text, NOT RouteDrawer.Description: that renders its own <p>
            and does not honour `asChild` here, so wrapping Text in it nests a
            <p> inside a <p>. Root sets `aria-describedby={undefined}` on the
            content anyway, so the wrapper buys nothing.
          */}
          <Text size="xsmall" className="text-ui-fg-subtle">
            Who this design order is for
          </Text>
        </div>
      </RouteDrawer.Header>
      <DesignOrderCustomerForm
        lineItemId={id!}
        customer={(designOrder as any).customer ?? null}
      />
    </RouteDrawer>
  )
}
