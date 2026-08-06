import { z } from "@medusajs/framework/zod"

/**
 * Carriers the partner shipping routes can drive.
 *
 * `domesticOnly` means the integration talks to that carrier's India-only
 * product. Delhivery is the case: we drive its Express last-mile API, while its
 * exports run on Cross Border — a separate Delhivery One service we are not
 * onboarded to. Offering it for a foreign address only produces an opaque
 * carrier error, so it is filtered out of the picker (and refused by the
 * backend adapter, which is the real guard).
 */
export const SHIPMENT_CARRIERS = [
  { value: "shiprocket", label: "Shiprocket" },
  { value: "delhivery", label: "Delhivery", domesticOnly: true },
] as const

/** True when a destination country is outside India (mirrors the backend). */
export const isInternationalDestination = (country?: string | null): boolean => {
  const raw = (country || "").trim()
  if (!raw) return false
  return !/^(in|india)$/i.test(raw)
}

/** The carriers that can actually ship to a given destination. */
export const carriersForDestination = (country?: string | null) =>
  SHIPMENT_CARRIERS.filter(
    (c) => !("domesticOnly" in c && c.domesticOnly) || !isInternationalDestination(country)
  )

export const CreateShipmentSchema = z.object({
  // Which carrier account a label is generated on. NOT sent to the shipment
  // endpoint — it only drives the label/AWB calls on the carrier step.
  carrier: z.string().optional(),
  labels: z.array(
    z.object({
      tracking_number: z.string(),
      // TODO: this 2 are not optional in the API
      tracking_url: z.string().optional(),
      label_url: z.string().optional(),
    })
  ),
  send_notification: z.boolean().optional(),
})
