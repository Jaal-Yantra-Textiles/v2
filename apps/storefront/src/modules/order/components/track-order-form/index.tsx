"use client"

import { useActionState } from "react"
import { Button } from "@medusajs/ui"
import Input from "@modules/common/components/input"
import { lookupOrder } from "@lib/data/orders"

export default function TrackOrderForm({ countryCode }: { countryCode: string }) {
  const [state, formAction, pending] = useActionState(lookupOrder, { error: null })

  return (
    <form action={formAction} className="flex flex-col gap-y-4" data-testid="track-order-form">
      <input type="hidden" name="country_code" value={countryCode} />
      <Input label="Order number" name="order_number" defaultValue={state?.order_number ?? ""} key={`n-${state?.order_number ?? ""}`} required inputMode="numeric" autoComplete="off" data-testid="track-order-number" />
      <Input label="Email" name="email" type="email" defaultValue={state?.email ?? ""} key={`e-${state?.email ?? ""}`} required autoComplete="email" data-testid="track-order-email" />
      {state?.error ? (
        <p className="text-small-regular text-rose-600" role="alert" data-testid="track-order-error">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="large" isLoading={pending} className="w-full" data-testid="track-order-submit">
        Find my order
      </Button>
    </form>
  )
}
