"use client"

import { useState } from "react"
import Image from "next/image"
import type { HttpTypes } from "@medusajs/types"
import { convertToLocale } from "@lib/util/money"
import { updateLineItem } from "@lib/data/cart"
import { useCartUpdate } from "@modules/checkout/context/cart-update-context"
import DeleteButton from "@modules/common/components/delete-button"
import PlaceholderImage from "@modules/common/icons/placeholder-image"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Loader } from "@medusajs/icons"

interface CheckoutItemListProps {
  cart: HttpTypes.StoreCart
}

function CheckoutItem({
  item,
  currencyCode,
}: {
  item: HttpTypes.StoreCartLineItem
  currencyCode: string
}) {
  const [updating, setUpdating] = useState(false)
  const { trackCartUpdate } = useCartUpdate()

  const imageUrl =
    item.thumbnail || item.variant?.product?.images?.[0]?.url || null

  const total = convertToLocale({
    amount: item.total ?? 0,
    currency_code: currencyCode,
  })

  const unitPrice = convertToLocale({
    amount: item.unit_price ?? 0,
    currency_code: currencyCode,
  })

  const variantTitle = item.variant?.title
  const maxQty = 10

  const changeQuantity = async (quantity: number) => {
    setUpdating(true)
    await trackCartUpdate(() => updateLineItem({ lineId: item.id, quantity }))
      .finally(() => setUpdating(false))
  }

  return (
    <div className="flex items-center justify-between gap-x-4">
      <div className="flex items-center gap-x-4">
        <LocalizedClientLink
          href={`/products/${item.product_handle}`}
          className="flex-shrink-0"
        >
          <div className="w-24 h-24 rounded-[6px] overflow-hidden bg-ui-bg-component shadow-elevation-card-rest flex items-center justify-center">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={item.product_title ?? ""}
                width={96}
                height={96}
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <PlaceholderImage size={24} />
            )}
          </div>
        </LocalizedClientLink>

        <div className="flex flex-col h-24 py-1 justify-between">
          <span className="txt-medium text-ui-fg-base">
            {item.product_title}
          </span>
          {variantTitle && (
            <span className="txt-medium text-ui-fg-subtle">{variantTitle}</span>
          )}
          <div className="flex items-end h-[22.4px]">
            <DeleteButton id={item.id} />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end justify-end h-24 py-1 flex-shrink-0 gap-2">
        <span className="txt-medium-plus text-ui-fg-base">
          {item.quantity > 1 ? `${item.quantity} x ${unitPrice}` : total}
        </span>

        <div className="flex items-center justify-center gap-x-4 h-6 px-2 bg-ui-bg-component shadow-elevation-card-rest rounded-[6px]">
          <button
            type="button"
            onClick={() => item.quantity > 1 && changeQuantity(item.quantity - 1)}
            disabled={updating || item.quantity <= 1}
            className="txt-compact-xlarge-plus text-ui-fg-subtle disabled:opacity-40 leading-none"
          >
            −
          </button>
          <span className="txt-compact-xsmall-plus text-ui-fg-subtle min-w-[12px] text-center">
            {updating ? (
              <Loader className="w-3 h-3 animate-spin" />
            ) : (
              item.quantity
            )}
          </span>
          <button
            type="button"
            onClick={() => item.quantity < maxQty && changeQuantity(item.quantity + 1)}
            disabled={updating || item.quantity >= maxQty}
            className="txt-compact-xlarge-plus text-ui-fg-subtle disabled:opacity-40 leading-none"
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The list scrolls where it stands, rather than opening a dialog.
 *
 * It first rendered three items and sent the rest to a modal. That modal was
 * the whole defect: the panel's padding and title were dead to the wheel, so
 * whether the list scrolled depended on where the buyer's cursor happened to
 * rest. A bounded scroller here has no dead ring at all — the box IS the
 * scroll target — and it keeps the buyer on the page they are paying on.
 *
 * The cap is what protects the totals. Three rows come to 338px, so a cart of
 * three or fewer never overflows and shows no scrollbar; a fourth starts
 * scrolling and the amount due stays on screen. One rule, no branch.
 */
const MAX_LIST_HEIGHT = 380
const NON_SCROLLING_ITEM_COUNT = 3

const ItemRows = ({
  items,
  currencyCode,
}: {
  items: HttpTypes.StoreCartLineItem[]
  currencyCode: string
}) => (
  <div className="flex flex-col">
    {items.map((item, idx) => (
      <div key={item.id}>
        <CheckoutItem item={item} currencyCode={currencyCode} />
        {idx < items.length - 1 && (
          <div className="h-px bg-ui-border-base my-3" />
        )}
      </div>
    ))}
  </div>
)

export default function CheckoutItemList({ cart }: CheckoutItemListProps) {
  const items = cart.items
    ? [...cart.items].sort((a, b) =>
        (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
      )
    : []

  const scrolls = items.length > NON_SCROLLING_ITEM_COUNT

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-x-3">
        <h2 className="h2-docs">Order composition</h2>
        {items.length > 0 && (
          <span className="txt-compact-small text-ui-fg-subtle">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/*
        `pe-4` only once it scrolls: a ~15px scrollbar sits ON the content and
        clipped the price — "2 x €8,500.0|0" with the stepper cut off. A cart
        that does not scroll has no scrollbar, and would just carry a gutter
        to nowhere.
      */}
      <div
        className={scrolls ? "overflow-y-auto pe-4" : undefined}
        style={scrolls ? { maxHeight: MAX_LIST_HEIGHT } : undefined}
        data-testid="checkout-item-list"
      >
        <ItemRows items={items} currencyCode={cart.currency_code} />
      </div>
    </div>
  )
}
