import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import {
  importTourBookingsWorkflow,
  parseGygWorkbook,
} from "../../../../../workflows/forms/import-tour-bookings"

/**
 * POST /admin/forms/:id/import-tour-bookings
 *
 * Multipart upload of a GetYourGuide bookings xlsx export. Each row becomes
 * a `form_response` pre-filled with traveller info and a visit token. The
 * customer opens /tours/visit/<token> to plan their itinerary.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const formId = req.params.id
  const files = (req as any).files as Array<{
    fieldname: string
    originalname: string
    buffer: Buffer
  }> | undefined

  const file = files?.[0]
  if (!file?.buffer?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Upload an xlsx file under the 'file' field"
    )
  }

  const ttlRaw = (req.query as any)?.token_ttl_days
  const ttl =
    typeof ttlRaw === "string"
      ? parseInt(ttlRaw, 10)
      : typeof ttlRaw === "number"
        ? ttlRaw
        : undefined

  const bookings = await parseGygWorkbook(file.buffer)

  const { result } = await importTourBookingsWorkflow(req.scope).run({
    input: {
      form_id: formId,
      bookings,
      token_ttl_days: Number.isFinite(ttl) ? ttl : undefined,
    },
  })

  res.status(200).json({
    created_count: result.created_count,
    skipped_count: result.skipped_count,
    skipped_booking_refs: result.skipped_booking_refs,
  })
}
