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
import { Button } from "@medusajs/ui"
import Modal from "@modules/common/components/modal"

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
 * How many items are shown before the list collapses.
 *
 * This block lives beside the totals now, and the totals are what a buyer
 * scrolls to. An unbounded list pushed them off-screen — the whole reason it
 * previously sat at the very bottom of the form column, below Contact, which
 * is the last place anyone looks for what they are buying.
 */
const INLINE_ITEM_LIMIT = 3

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

  const [showAll, setShowAll] = useState(false)

  const overflowCount = Math.max(0, items.length - INLINE_ITEM_LIMIT)
  const inlineItems = overflowCount ? items.slice(0, INLINE_ITEM_LIMIT) : items

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

      <ItemRows items={inlineItems} currencyCode={cart.currency_code} />

      {overflowCount > 0 && (
        <>
          <Button
            variant="transparent"
            className="mt-2 px-0 text-ui-fg-interactive hover:bg-transparent"
            onClick={() => setShowAll(true)}
            data-testid="checkout-view-all-items"
          >
            View all {items.length} items
          </Button>

          {/*
            The same Modal the account address cards use, rather than a
            bespoke overlay — it traps focus and closes on Escape, which a
            hand-rolled panel in a checkout would have to get right itself.
          */}
          <Modal
            isOpen={showAll}
            close={() => setShowAll(false)}
            size="medium"
            data-testid="checkout-items-modal"
          >
            <Modal.Title>Order composition</Modal.Title>
            <Modal.Body>
              {/* Scrolls inside the dialog: a 30-item cart must not make the
                  modal itself taller than the viewport. */}
              <div className="max-h-[60vh] overflow-y-auto pe-1">
                <ItemRows items={items} currencyCode={cart.currency_code} />
              </div>
            </Modal.Body>
          </Modal>
        </>
      )}
    </div>
  )
}