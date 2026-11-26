"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { cancelOrder } from "@lib/data/orders"

/**
 * Lets a customer cancel an unpaid, unshipped order (cash on delivery).
 * Two taps on purpose, so a stray click can't cancel an order; no browser
 * confirm() dialog.
 */
export default function CancelOrder({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const onConfirm = () =>
    startTransition(async () => {
      setError(null)
      const res = await cancelOrder(orderId)
      if (!res.ok) {
        setError(res.error)
        setConfirming(false)
        return
      }
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-2" data-testid="cancel-order">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start text-small-regular text-ui-fg-error underline underline-offset-2 hover:text-ui-fg-base"
          data-testid="cancel-order-button"
        >
          Cancel order
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-ui-border-base p-3">
          <span className="text-small-regular text-ui-fg-base">
            Cancel this order? This can&apos;t be undone.
          </span>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-ui-button-danger px-3 py-1.5 text-small-semi text-ui-fg-on-color disabled:opacity-60"
            data-testid="cancel-order-confirm"
          >
            {pending ? "Cancelling…" : "Yes, cancel order"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-small-regular text-ui-fg-subtle hover:text-ui-fg-base"
          >
            Keep order
          </button>
        </div>
      )}
      {error && (
        <span className="text-small-regular text-ui-fg-error" data-testid="cancel-order-error">
          {error}
        </span>
      )}
    </div>
  )
}
