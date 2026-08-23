"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import { buildDialHref, type DialledLine } from "@lib/util/quote-lines"

/**
 * Type a quantity and let the server re-price (#1439 S13).
 *
 * The only client component in the quantity control, and it holds exactly one
 * piece of state: the characters currently in the box. It does no arithmetic
 * with money — on commit it pushes a URL and the server returns a fully
 * re-priced document, identical to what the +/− links do.
 *
 * 🔴 The displayed value must follow the SERVER's quantity, not the typing. A
 * buyer who types 400, commits, and then presses Back has a page whose prices
 * are for 250; a box still reading 400 would be describing a basket that is not
 * on screen. `useEffect` on the prop resynchronises after every navigation.
 *
 * Commit on Enter or blur, never per keystroke: a fetch and a full re-price for
 * every digit of "1000" is four wrong baskets on the way to the right one.
 */
const QuoteQuantityInput = ({
  countryCode,
  token,
  lines,
  variantId,
  quantity,
}: {
  countryCode: string
  token: string
  lines: DialledLine[]
  variantId: string
  quantity: number
}) => {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState(String(quantity))

  useEffect(() => {
    setValue(String(quantity))
  }, [quantity])

  const commit = () => {
    const next = Number(value)

    // Anything that is not a whole number of units at least one snaps back to
    // what is actually on screen. Clamping to a nearby number the buyer did not
    // type is worse: they would be ordering a quantity nobody chose.
    if (!Number.isInteger(next) || next < 1) {
      setValue(String(quantity))
      return
    }
    if (next === quantity) {
      return
    }

    startTransition(() => {
      router.push(
        buildDialHref({ countryCode, token, lines, variantId, quantity: next }),
        { scroll: false }
      )
    })
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label="Quantity"
      className="h-8 w-16 rounded-md border border-ui-border-base bg-ui-bg-field text-center txt-medium text-ui-fg-base focus:outline-none focus:border-ui-border-interactive disabled:text-ui-fg-disabled"
      value={value}
      disabled={pending}
      onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === "Escape") {
          setValue(String(quantity))
        }
      }}
    />
  )
}

export default QuoteQuantityInput
