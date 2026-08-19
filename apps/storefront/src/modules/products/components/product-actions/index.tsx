"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import { HttpTypes } from "@medusajs/types"
import { Button, Text } from "@medusajs/ui"
import Divider from "@modules/common/components/divider"
import OptionSelect from "@modules/products/components/product-actions/option-select"
import { isEqual } from "lodash"
import { useParams, usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import ProductPrice from "../product-price"
import MobileActions from "./mobile-actions"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import SpecChoices from "../production-spec/spec-choices"
import {
  blockedGroups,
  hasAnySpecChoice,
  initialSpecChoices,
  leadTimePhrase,
  needsSecondStep,
  summariseChoices,
  type SpecChoiceState,
} from "../production-spec/spec-choices-util"
import {
  addMadeToSpecToCart,
  type StoreProductSpec,
} from "@lib/data/product-spec"
import { useRouter } from "next/navigation"

type ProductActionsProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
  // #1365 — the partner's made-to-order spec, fetched server-side by the
  // wrapper. Absent (or not accepting custom orders) leaves every line below
  // inert, so an ordinary product's buying column is byte-for-byte unchanged.
  spec?: StoreProductSpec | null
}

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"]
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt: any) => {
    acc[varopt.option_id] = varopt.value
    return acc
  }, {})
}

export default function ProductActions({
  product,
  disabled,
  spec = null,
}: ProductActionsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  const [isAdding, setIsAdding] = useState(false)
  const countryCode = useParams().countryCode as string

  // #1365 — made-to-order selection lives HERE, beside the variant options,
  // because one button now decides between an ordinary purchase and a woven-to
  // -order one by reading it.
  const [specChoices, setSpecChoices] = useState<SpecChoiceState>(() =>
    initialSpecChoices(spec)
  )
  const [specError, setSpecError] = useState<string | null>(null)

  const offersChoices = !!spec?.accepting_custom_orders
  const secondStep = needsSecondStep(spec)
  const madeToOrder = hasAnySpecChoice(spec, specChoices)
  const specBlocked = blockedGroups(spec)
  const leadTime = leadTimePhrase(spec)

  // If there is only 1 variant, preselect the options
  useEffect(() => {
    if (product.variants?.length === 1) {
      const variantOptions = optionsAsKeymap(product.variants[0].options)
      setOptions(variantOptions ?? {})
    }
  }, [product.variants])

  const selectedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) {
      return
    }

    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  // update the options when a variant is selected
  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({
      ...prev,
      [optionId]: value,
    }))
  }

  //check if the selected options produce a valid variant
  const isValidVariant = useMemo(() => {
    return product.variants?.some((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const value = isValidVariant ? selectedVariant?.id : null

    if (params.get("v_id") === value) {
      return
    }

    if (value) {
      params.set("v_id", value)
    } else {
      params.delete("v_id")
    }

    router.replace(pathname + "?" + params.toString())
  }, [selectedVariant, isValidVariant])

  // check if the selected variant is in stock
  const inStock = useMemo(() => {
    // If we don't manage inventory, we can always add to cart
    if (selectedVariant && !selectedVariant.manage_inventory) {
      return true
    }

    // If we allow back orders on the variant, we can add to cart
    if (selectedVariant?.allow_backorder) {
      return true
    }

    // If there is inventory available, we can add to cart
    if (
      selectedVariant?.manage_inventory &&
      (selectedVariant?.inventory_quantity || 0) > 0
    ) {
      return true
    }

    // Otherwise, we can't add to cart
    return false
  }, [selectedVariant])

  const actionsRef = useRef<HTMLDivElement>(null)

  const inView = useIntersection(actionsRef, "0px")

  // add the selected variant to the cart
  const handleAddToCart = async () => {
    if (!selectedVariant?.id) return null

    setIsAdding(true)
    setSpecError(null)

    // The analytics snippet (analytics.min.js) writes its visitor id to
    // localStorage["jyt_visitor_id"]. Reading it here and passing it
    // through is what links this cart back to the visitor's browsing
    // signals (scroll depth / time-on-page / pageviews) for the
    // intent-score join used by cart recovery. Best-effort: if the
    // analytics script hasn't loaded yet or storage is unavailable
    // (private mode, SSR), we silently send undefined.
    let visitorId: string | undefined
    try {
      visitorId = window.localStorage.getItem("jyt_visitor_id") ?? undefined
    } catch {
      visitorId = undefined
    }

    // #1365 — ONE button. Which purchase it makes is decided by whether the
    // customer expressed a made-to-order intent, not by which of two buttons
    // they found.
    try {
      if (madeToOrder) {
        await addMadeToSpecToCart({
          variantId: selectedVariant.id,
          quantity: 1,
          color: specChoices.color,
          note: specChoices.note,
          options: specChoices.options,
          countryCode,
        })
      } else {
        await addToCart({
          variantId: selectedVariant.id,
          quantity: 1,
          countryCode,
          visitorId,
        })
      }
    } catch (e: any) {
      // The backend's rejection names the colours that ARE available. Showing
      // our own generic message instead would throw that away.
      setSpecError(e?.message || "We couldn't add this to your cart.")
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-y-2" ref={actionsRef}>
        <div>
          {(product.variants?.length ?? 0) > 1 && (
            <div className="flex flex-col gap-y-4">
              {(product.options || []).map((option) => {
                return (
                  <div key={option.id}>
                    <OptionSelect
                      option={option}
                      current={options[option.id]}
                      updateOption={setOptionValue}
                      title={option.title ?? ""}
                      data-testid="product-options"
                      disabled={!!disabled || isAdding}
                    />
                  </div>
                )
              })}
              <Divider />
            </div>
          )}
        </div>

        {/* #1365 — between the variant selector and the price. A made-to-order
            choice is part of deciding WHAT you are buying, so it belongs above
            the number, not below the button. */}
        {offersChoices && !secondStep && (
          <div className="flex flex-col gap-y-4 pb-2">
            <SpecChoices
              spec={spec!}
              value={specChoices}
              onChange={setSpecChoices}
              disabled={!!disabled || isAdding}
            />
          </div>
        )}

        {/* Too many choices for a narrow column. A summary of what is on offer
            and a real link — never a disclosure that reflows the whole page. */}
        {offersChoices && secondStep && (
          <div
            className="flex flex-col gap-y-1 pb-2"
            data-testid="customise-summary"
          >
            <Text size="small" className="text-ui-fg-subtle">
              Made to order — {summariseChoices(spec)}
            </Text>
            <LocalizedClientLink
              href={`/products/${product.handle}/customise`}
              className="text-ui-fg-base underline underline-offset-4 txt-compact-small-plus"
              data-testid="customise-link"
            >
              Customise this piece &rarr;
            </LocalizedClientLink>
          </div>
        )}

        <ProductPrice product={product} variant={selectedVariant} />

        <div className="flex flex-col gap-y-4">
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            animate={isAdding ? { opacity: [1, 0.5, 1], transition: { duration: 0.8, repeat: Infinity } } : {}}
          >
            <Button
              onClick={handleAddToCart}
              disabled={
                !inStock ||
                !selectedVariant ||
                !!disabled ||
                isAdding ||
                !isValidVariant ||
                (madeToOrder && !!specBlocked.length)
              }
              variant="primary"
              className="w-full h-10 shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-shadow"
              isLoading={isAdding}
              data-testid="add-product-button"
            >
              {!selectedVariant && !(product.options || []).every((opt) => options[opt.id])
                ? "Select variant"
                : !inStock || !isValidVariant
                  ? "Out of stock"
                  : "Add to cart"}
            </Button>
          </motion.div>

          {/* #1365 — #1349 split the two buttons precisely so the wait could not
              hide until checkout. Folding them back into one is only honest
              with this line present: it appears the moment the selection turns
              the purchase into a made-to-order one. */}
          {madeToOrder && leadTime && (
            <Text
              size="small"
              className="text-ui-fg-subtle text-center"
              data-testid="made-to-order-lead-time"
            >
              {leadTime}
            </Text>
          )}
          {specError && (
            <Text
              size="small"
              className="text-ui-fg-error"
              data-testid="spec-error"
            >
              {specError}
            </Text>
          )}

          <div className="mt-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
            <p className="text-sm text-ui-fg-subtle mb-3">
              Want something unique? Create your own version of this design — choose your own fabrics and production partners while keeping the same design philosophy.
            </p>
            <Link href={`/products/${product.handle}/design`} passHref>
              <Button variant="secondary" className="w-full h-10">
                Create your own design
              </Button>
            </Link>
          </div>
        </div>
        <MobileActions
          product={product}
          variant={selectedVariant}
          options={options}
          updateOptions={setOptionValue}
          inStock={inStock}
          handleAddToCart={handleAddToCart}
          isAdding={isAdding}
          show={!inView}
          optionsDisabled={!!disabled || isAdding}
        />
      </div>
    </>
  )
}
