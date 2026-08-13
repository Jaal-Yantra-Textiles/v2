/**
 * Persist a booked carrier pickup onto the fulfillment.
 *
 * Both pickup routes (admin and partner) used to book the collection with the
 * carrier and then return the result to the browser and nothing else. Three
 * things broke as a result, and all three look like separate bugs until you find
 * this one:
 *
 *  1. The partner UI gates its "pickup booked" block on
 *     `fulfillment.metadata.pickup_id`, which nothing ever wrote — so the
 *     booking form never collapsed and a partner who had already booked a pickup
 *     saw an empty form inviting them to book a second one.
 *  2. The admin widget held the booking in React state, so a refresh erased it.
 *  3. **The cancellation token was thrown away.** Blue Dart returns its handle as
 *     `TokenNumber` and it is the only thing that can call a collection off; once
 *     the response left the browser tab, the pickup could only be cancelled by
 *     phone.
 *
 * Metadata rather than `fulfillment.data`: `data` is the carrier's own opaque
 * blob (and is cleared wholesale by cancel-shipment, which must NOT erase the
 * record of a collection the carrier is still coming for), while `metadata` is
 * the queryable, ours-to-own field both UIs already read.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

export type PickupBookingRecord = {
  pickup_id?: string
  pickup_date: string
  pickup_time: string
  incoming_center_name?: string
  carrier?: string
  booked_at: string
}

export async function persistPickupBooking(
  scope: MedusaContainer,
  fulfillmentId: string,
  booking: Omit<PickupBookingRecord, "booked_at">,
  existingMetadata?: Record<string, any> | null
): Promise<PickupBookingRecord> {
  const record: PickupBookingRecord = {
    ...booking,
    booked_at: new Date().toISOString(),
  }

  const fulfillmentModule = scope.resolve(Modules.FULFILLMENT)

  await fulfillmentModule.updateFulfillment(fulfillmentId, {
    metadata: {
      ...(existingMetadata || {}),
      ...record,
      // Keep every booking, not just the latest. A rebooked pickup (carrier
      // no-show, date moved) otherwise silently overwrites the token of a
      // collection that may still be live, which is the same class of orphan
      // cancel-shipment exists to prevent.
      pickup_bookings: [
        ...((existingMetadata?.pickup_bookings as PickupBookingRecord[]) || []),
        record,
      ],
    },
  })

  return record
}

/**
 * Best-effort variant. The pickup is ALREADY booked with the carrier by the time
 * this runs, so a write failure must not be reported to the operator as "pickup
 * failed" — that would send them to book a second collection for the same
 * parcel. Same reasoning as the courier-changed email in cancel-shipment.
 */
export async function persistPickupBookingSafely(
  scope: MedusaContainer,
  fulfillmentId: string,
  booking: Omit<PickupBookingRecord, "booked_at">,
  existingMetadata?: Record<string, any> | null
): Promise<{ persisted: boolean; record: PickupBookingRecord }> {
  const record: PickupBookingRecord = {
    ...booking,
    booked_at: new Date().toISOString(),
  }
  try {
    const saved = await persistPickupBooking(
      scope,
      fulfillmentId,
      booking,
      existingMetadata
    )
    return { persisted: true, record: saved }
  } catch (e) {
    const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(
      `Pickup ${booking.pickup_id ?? "(no id)"} was booked with ${
        booking.carrier ?? "the carrier"
      } for fulfillment ${fulfillmentId} but could NOT be saved: ${
        (e as Error)?.message
      }. The collection is live and its cancellation token is now only in this log line.`
    )
    return { persisted: false, record }
  }
}
