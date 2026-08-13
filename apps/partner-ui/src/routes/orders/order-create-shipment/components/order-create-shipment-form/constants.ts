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
  // Blue Dart is NOT domestic-only: product "H" (IPC) is a real export product
  // on the same account. Must stay in step with the admin twin at
  // `apps/backend/src/admin/lib/shipment-carriers.ts` — both pickers drive the
  // same backend, whose `SUPPORTED_CARRIERS` is the real authority.
  { value: "bluedart", label: "Blue Dart" },
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

// Empty string → undefined, else a positive number. Parcel fields are optional;
// a blank must not coerce to 0 (which would be a real, wrong, zero-gram parcel).
const optionalPositive = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().positive().optional()
)

export const CreateShipmentSchema = z.object({
  // Which carrier account a label is generated on. NOT sent to the shipment
  // endpoint — it only drives the label/AWB calls on the carrier step.
  carrier: z.string().optional(),
  // Parcel details for label generation (carrier step only). Omitted → the
  // backend default weight, which is why every label used to ship at 500 g.
  weight_grams: optionalPositive,
  length_cm: optionalPositive,
  width_cm: optionalPositive,
  height_cm: optionalPositive,
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
