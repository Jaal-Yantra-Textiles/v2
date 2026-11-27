"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { checkBitcoinPayment } from "@lib/data/cart"

const EVERY_MS = 20_000
const GIVE_UP_AFTER = 90 // ~30 minutes of polling; the webhook still places the order after

/** Re-asks the server whether the Bitcoin payment has confirmed. */
export default function BitcoinPendingPoller({ cartId }: { cartId: string }) {
  const router = useRouter()
  const [note, setNote] = useState("Checking every 20 seconds…")
  const tries = useRef(0)

  useEffect(() => {
    let stopped = false
    const tick = async () => {
      if (stopped) return
      tries.current += 1
      const r = await checkBitcoinPayment(cartId).catch(() => ({ status: "waiting" as const }))
      if (stopped) return
      if (r.status === "order") return router.replace(r.url)
      if (r.status === "failed") {
        setNote(r.error)
        return
      }
      if (tries.current >= GIVE_UP_AFTER) {
        setNote("Still waiting for the network. We will email you as soon as your order is placed.")
        return
      }
      setTimeout(tick, EVERY_MS)
    }
    const t = setTimeout(tick, EVERY_MS)
    return () => {
      stopped = true
      clearTimeout(t)
    }
  }, [cartId, router])

  return (
    <p className="text-small-regular text-ui-fg-muted" data-testid="bitcoin-pending-status">
      {note}
    </p>
  )
}
