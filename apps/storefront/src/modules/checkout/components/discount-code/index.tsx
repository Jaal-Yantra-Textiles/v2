"use client"

import { Badge, Heading, Input, Label, Text } from "@medusajs/ui"
import { useRouter } from "next/navigation"
import React from "react"

import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Trash from "@modules/common/icons/trash"
import ErrorMessage from "../error-message"
import { SubmitButton } from "../submit-button"

type DiscountCodeProps = {
  cart: HttpTypes.StoreCart & {
    promotions: HttpTypes.StorePromotion[]
  }
}
const DiscountCode: React.FC<DiscountCodeProps> = ({ cart }) => {
  const router = useRouter()
  const [isOpen, setIsOpen] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState("")
  /**
   * A refusal that a sign-in would actually fix — a one-per-customer code on a
   * cart with no buyer (#2194). The shopper needs the route, not just the
   * sentence, so the error renders with a link beside it.
   */
  const [needsSignIn, setNeedsSignIn] = React.useState(false)
  const [isBusy, setIsBusy] = React.useState(false)
  const [, startTransition] = React.useTransition()

  const { promotions = [] } = cart

  /**
   * 🔴 THE MUTATION IS NOT THE END OF THE JOB — THE RE-RENDER IS.
   *
   * Both handlers below POST to `/api/cart/promotions` and used to stop
   * there. `cart` is a prop from a SERVER component, so nothing re-fetched
   * it and the panel kept rendering the pre-mutation cart until the shopper
   * happened to reload.
   *
   * Observed on a live order, in BOTH directions:
   *
   *   remove FRIENDS -> server: no promotions, total €201.81
   *                     page:   FRIENDS (50%), −€91.00, total €110.81
   *   apply  FRIENDS -> server: FRIENDS, total €110.81
   *                     page:   no discount, total €201.81
   *
   * Either way the buyer is shown a total that is not the one they would be
   * charged, off by the whole discount. See #2194.
   *
   * `applyPromotions` already calls `revalidateTag`, and that is NOT enough:
   * it invalidates the server cache, but this runs through a ROUTE HANDLER
   * rather than a server action, so nothing pushes a fresh render to the
   * client. `router.refresh()` is what re-fetches the RSC payload. (The tag
   * can also be a no-op outright — `getCacheTag` returns "" when there is no
   * `_medusa_cache_id` cookie, which is the case for a buyer arriving from a
   * link.)
   */
  const refreshCart = () => startTransition(() => router.refresh())

  const removePromotionCode = async (code: string) => {
    const validPromotions = promotions.filter((promotion) => promotion.code !== code)

    setErrorMessage("")
    setNeedsSignIn(false)
    setIsBusy(true)
    try {
      const res = await fetch("/api/cart/promotions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          codes: validPromotions
            .filter((p) => p.code !== undefined)
            .map((p) => p.code!),
        }),
      })
      const json = await res.json()
      if (!json?.ok) {
        setNeedsSignIn(Boolean(json?.requires_sign_in))
        throw new Error(json?.error || "Failed to update promotions")
      }
      refreshCart()
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to update promotions")
    } finally {
      setIsBusy(false)
    }
  }

  const addPromotionCode = async (formData: FormData) => {
    setErrorMessage("")
    setNeedsSignIn(false)
    if (isBusy) {
      return
    }

    const code = formData.get("code")
    if (!code) {
      return
    }
    const input = document.getElementById("promotion-input") as HTMLInputElement
    // Normalize user input to avoid server-side pattern errors
    const raw = String(code)
    const normalized = raw.trim().toUpperCase()
    if (!normalized) {
      setErrorMessage("Please enter a valid promotion code")
      return
    }

    const codes = promotions
      .filter((p) => p.code !== undefined)
      .map((p) => p.code!)
    // Avoid adding duplicates
    if (!codes.includes(normalized)) {
      codes.push(normalized)
    }

    setIsBusy(true)
    try {
      const res = await fetch("/api/cart/promotions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes }),
      })
      const json = await res.json()
      if (!json?.ok) {
        setNeedsSignIn(Boolean(json?.requires_sign_in))
        throw new Error(json?.error || "Failed to apply promotions")
      }
      /**
       * Only clear the field on SUCCESS. Clearing it unconditionally — which
       * is what happened before — wiped a rejected code and left no error
       * beside it, so a refused promotion was indistinguishable from an
       * accepted one.
       */
      if (input) {
        input.value = ""
      }
      refreshCart()
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to apply promotions")
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="w-full flex flex-col rounded-rounded border border-ui-border-base bg-white p-4">
      <div className="txt-medium">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const formData = new FormData(e.currentTarget)
            void addPromotionCode(formData)
          }}
          className="w-full mb-5"
        >
          <Label className="flex gap-x-1 my-2 items-center">
            <button
              onClick={() => setIsOpen(!isOpen)}
              type="button"
              className="txt-medium text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              data-testid="add-discount-button"
            >
              Add Promotion Code(s)
            </button>

            {/* <Tooltip content="You can add multiple promotion codes">
              <InformationCircleSolid color="var(--fg-muted)" />
            </Tooltip> */}
          </Label>

          {isOpen && (
            <>
              <div className="flex w-full gap-x-2">
                <Input
                  className="size-full"
                  id="promotion-input"
                  name="code"
                  type="text"
                  autoFocus={false}
                  disabled={isBusy}
                  data-testid="discount-input"
                />
                <SubmitButton
                  variant="secondary"
                  pending={isBusy}
                  data-testid="discount-apply-button"
                >
                  Apply
                </SubmitButton>
              </div>

              <ErrorMessage
                error={errorMessage}
                data-testid="discount-error-message"
              />

              {needsSignIn && (
                <LocalizedClientLink
                  href="/account"
                  className="mt-1 inline-block text-small-regular text-ui-fg-interactive hover:text-ui-fg-interactive-hover underline"
                  data-testid="discount-sign-in-link"
                >
                  Sign in to use this code
                </LocalizedClientLink>
              )}
            </>
          )}
        </form>

        {promotions.length > 0 && (
          <div className="w-full flex items-center">
            <div className="flex flex-col w-full">
              <Heading className="txt-medium mb-2">
                Promotion(s) applied:
              </Heading>

              {promotions.map((promotion) => {
                return (
                  <div
                    key={promotion.id}
                    className="flex items-center justify-between w-full max-w-full mb-2"
                    data-testid="discount-row"
                  >
                    <Text className="flex gap-x-1 items-baseline txt-small-plus w-4/5 pr-1">
                      <span className="truncate" data-testid="discount-code">
                        <Badge
                          color={promotion.is_automatic ? "green" : "grey"}
                          size="small"
                        >
                          {promotion.code}
                        </Badge>{" "}
                        (
                        {promotion.application_method?.value !== undefined &&
                          promotion.application_method.currency_code !==
                            undefined && (
                            <>
                              {promotion.application_method.type ===
                              "percentage"
                                ? `${promotion.application_method.value}%`
                                : convertToLocale({
                                    amount: +promotion.application_method.value,
                                    currency_code:
                                      promotion.application_method
                                        .currency_code,
                                  })}
                            </>
                          )}
                        )
                        {/* {promotion.is_automatic && (
                          <Tooltip content="This promotion is automatically applied">
                            <InformationCircleSolid className="inline text-zinc-400" />
                          </Tooltip>
                        )} */}
                      </span>
                    </Text>
                    {!promotion.is_automatic && (
                      <button
                        className="flex items-center disabled:opacity-50"
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          if (!promotion.code) {
                            return
                          }

                          removePromotionCode(promotion.code)
                        }}
                        data-testid="remove-discount-button"
                      >
                        <Trash size={14} />
                        <span className="sr-only">
                          Remove discount code from order
                        </span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DiscountCode
