import { z } from "@medusajs/framework/zod"

/** Carriers the partner shipping routes can drive. */
export const SHIPMENT_CARRIERS = [
  { value: "shiprocket", label: "Shiprocket" },
  { value: "delhivery", label: "Delhivery" },
] as const

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
