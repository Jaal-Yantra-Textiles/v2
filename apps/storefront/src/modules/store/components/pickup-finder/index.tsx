"use client"

import { useState, useTransition } from "react"
import { getPickupLocations, PickupLocation } from "@lib/data/pickup-locations"

function formatPrice(price: { amount: number; currency_code: string } | null) {
  if (!price) return "Free"
  if (price.amount === 0) return "Free"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency_code.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(price.amount)
}

export default function PickupFinder({
  countryCode,
}: {
  countryCode: string
}) {
  const [pincode, setPincode] = useState("")
  const [locations, setLocations] = useState<PickupLocation[]>([])
  const [searched, setSearched] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSearch = () => {
    if (!pincode.trim()) return

    startTransition(async () => {
      const result = await getPickupLocations(pincode.trim(), countryCode)
      setLocations(result.pickup_locations)
      setSearched(true)
    })
  }

  return (
    <div className="w-full">
      <h3 className="text-lg font-medium mb-2">Find Pickup Locations</h3>
      <p className="text-sm text-neutral-500 mb-4">
        Enter your pincode to find nearby stores for in-person pickup.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={pincode}
          onChange={(e) => setPincode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Enter pincode..."
          className="flex-1 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          maxLength={10}
        />
        <button
          onClick={handleSearch}
          disabled={isPending || !pincode.trim()}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Searching..." : "Search"}
        </button>
      </div>

      {searched && locations.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-200 p-6 text-center">
          <p className="text-sm text-neutral-500">
            No pickup locations found near {pincode}. Try a different pincode or
            check back later.
          </p>
        </div>
      )}

      {locations.length > 0 && (
        <div className="space-y-3">
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="rounded-lg border border-neutral-200 p-4 hover:border-neutral-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h4 className="font-medium text-sm">{loc.name}</h4>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {[
                      loc.address.address_1,
                      loc.address.address_2,
                      loc.address.city,
                      loc.address.province,
                      loc.address.postal_code,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  {loc.address.phone && (
                    <p className="text-xs text-neutral-400 mt-0.5">
                      Phone: {loc.address.phone}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {loc.proximity > 0 && (
                    <span className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      Nearby
                    </span>
                  )}
                </div>
              </div>

              {loc.pickup_options.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {loc.pickup_options.map((opt) => (
                    <span
                      key={opt.id}
                      className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs"
                    >
                      <span className="font-medium">{opt.name}</span>
                      <span className="text-neutral-500">
                        {formatPrice(opt.price)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
