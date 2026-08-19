"use client"

import { Button, Text, clx } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import Image from "next/image"

import {
  addMadeToSpecToCart,
  type StoreProductSpec,
} from "@lib/data/product-spec"
import SpecChoices from "@modules/products/components/production-spec/spec-choices"
import {
  blockedGroups,
  initialSpecChoices,
  leadTimePhrase,
  type SpecChoiceState,
} from "@modules/products/components/production-spec/spec-choices-util"

/**
 * #1365 — the second step of the made-to-order configurator.
 *
 * A real route rather than a modal or an expander. Three reasons, all of which
 * a disclosure fails: the choices that land here are the ones too numerous for
 * a 300px column, so they need the width; a customer mid-configuration can send
 * someone the URL; and the back button means something.
 *
 * The image stays PINNED while the choices scroll. Someone choosing a colour is
 * looking at the cloth, and a layout that scrolls the cloth off the top makes
 * them choose from memory.
 */

type Props = {
  product: HttpTypes.StoreProduct
  spec: StoreProductSpec
  images: HttpTypes.StoreProductImage[]
}

const CustomiseForm = ({ product, spec, images }: Props) => {
  const router = useRouter()
  const countryCode = useParams().countryCode as string

  const [active, setActive] = useState(0)
  const [variantId, setVariantId] = useState(product.variants?.[0]?.id ?? "")
  const [choices, setChoices] = useState<SpecChoiceState>(() =>
    initialSpecChoices(spec)
  )
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const specBlocked = useMemo(() => blockedGroups(spec), [spec])
  const leadTime = leadTimePhrase(spec)

  const handleAdd = async () => {
    if (!variantId) return
    setIsAdding(true)
    setError(null)
    try {
      await addMadeToSpecToCart({
        variantId,
        quantity: 1,
        color: choices.color,
        note: choices.note,
        options: choices.options,
        countryCode,
      })
      // Back to the product, where the cart drawer lives. Pushing to the cart
      // instead would strand anyone who wanted a second piece in another
      // colour — the common case for a made-to-order palette.
      router.push(`/${countryCode}/products/${product.handle}`)
      router.refresh()
    } catch (e: any) {
      // The backend's rejection names what IS available. Replacing it with our
      // own generic message would throw that away.
      setError(e?.message || "We couldn't add this made-to-order piece.")
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div
      className="content-container flex flex-col small:flex-row small:items-start gap-8 py-6"
      data-testid="customise-container"
    >
      <div className="w-full small:w-1/2 small:sticky small:top-24">
        <div className="relative aspect-[29/34] w-full overflow-hidden rounded-lg bg-ui-bg-subtle">
          {images[active]?.url && (
            <Image
              src={images[active].url}
              alt={`${product.title} — view ${active + 1}`}
              fill
              sizes="(max-width: 576px) 100vw, 50vw"
              className="object-cover"
              priority
            />
          )}
        </div>
        {images.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="customise-thumbs">
            {images.map((image, index) => (
              <button
                key={image.id ?? index}
                type="button"
                onClick={() => setActive(index)}
                aria-label={`View ${index + 1}`}
                aria-pressed={index === active}
                className={clx(
                  "relative size-16 overflow-hidden rounded-md border",
                  index === active
                    ? "border-ui-fg-base"
                    : "border-ui-border-base hover:border-ui-fg-muted"
                )}
              >
                {image.url && (
                  <Image
                    src={image.url}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex w-full small:w-1/2 flex-col gap-y-6">
        <div className="flex flex-col gap-y-1">
          <Text className="text-ui-fg-base text-2xl font-medium">
            Customise your {product.title}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Every piece is woven after you order it, so these are real choices —
            not a selection from stock.
          </Text>
        </div>

        {(product.variants?.length ?? 0) > 1 && (
          <div className="flex flex-col gap-y-2">
            <Text size="small" className="text-ui-fg-subtle">
              Size
            </Text>
            <select
              className="border-ui-border-base bg-ui-bg-field h-10 rounded-md border px-3 text-sm"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              data-testid="customise-variant"
            >
              {(product.variants ?? []).map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <SpecChoices
          spec={spec}
          value={choices}
          onChange={setChoices}
          disabled={isAdding}
          layout="wide"
        />

        {!!specBlocked.length && (
          <Text size="small" className="text-ui-fg-error">
            {specBlocked.map((group) => group.label).join(", ")} cannot be made
            at the moment, so this piece can't be ordered yet.
          </Text>
        )}

        {error && (
          <Text size="small" className="text-ui-fg-error" data-testid="customise-error">
            {error}
          </Text>
        )}

        <div className="flex flex-col gap-y-2">
          <Button
            onClick={handleAdd}
            isLoading={isAdding}
            disabled={isAdding || !variantId || !!specBlocked.length}
            variant="primary"
            className="w-full h-10"
            data-testid="customise-add-button"
          >
            Add to cart
          </Button>
          {/* The same honesty the single button owes on the product page. */}
          {leadTime && (
            <Text
              size="small"
              className="text-ui-fg-subtle text-center"
              data-testid="customise-lead-time"
            >
              {leadTime}
            </Text>
          )}
        </div>
      </div>
    </div>
  )
}

export default CustomiseForm
