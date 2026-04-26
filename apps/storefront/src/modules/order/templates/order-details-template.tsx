"use client"

import { XMark } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Help from "@modules/order/components/help"
import Items from "@modules/order/components/items"
import OrderDetails from "@modules/order/components/order-details"
import OrderSummary from "@modules/order/components/order-summary"
import OrderStatusTimeline from "@modules/order/components/order-status-timeline"
import ReturnRequest from "@modules/order/components/return-request"
import ShippingDetails from "@modules/order/components/shipping-details"
import React from "react"

import { ReturnShippingOption } from "@lib/data/orders"

type OrderDetailsTemplateProps = {
  order: HttpTypes.StoreOrder
  /** Hide back link and account-specific UI (for public order page) */
  isPublic?: boolean
  /** Available return shipping options fetched from the API */
  returnShippingOptions?: ReturnShippingOption[]
}

const OrderDetailsTemplate: React.FC<OrderDetailsTemplateProps> = ({
  order,
  isPublic = false,
  returnShippingOptions = [],
}) => {
  return (
    <div className="flex flex-col justify-center gap-y-4">
      <div className="flex gap-2 justify-between items-center">
        <h1 className="text-2xl-semi">Order details</h1>
        {!isPublic && (
          <LocalizedClientLink
            href="/account/orders"
            className="flex gap-2 items-center text-ui-fg-subtle hover:text-ui-fg-base"
            data-testid="back-to-overview-button"
          >
            <XMark /> Back to overview
          </LocalizedClientLink>
        )}
      </div>
      <div
        className="flex flex-col gap-4 h-full bg-white w-full"
        data-testid="order-details-container"
      >
        <OrderDetails order={order} showStatus />
        <OrderStatusTimeline order={order} variant="full" />
        <Items order={order} />
        <ShippingDetails order={order} />
        <OrderSummary order={order} />
        {!isPublic && returnShippingOptions.length > 0 && (
          <ReturnRequest order={order} returnShippingOptions={returnShippingOptions} />
        )}
        {!isPublic && <Help />}
      </div>
    </div>
  )
}

export default OrderDetailsTemplate
