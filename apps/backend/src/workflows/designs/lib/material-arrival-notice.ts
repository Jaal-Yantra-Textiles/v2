/**
 * Who hears that a design's material has arrived, and when (#2111).
 *
 * The pure half of the pipeline, so the rules can be broken deliberately in a
 * test rather than argued about against a live inbox. The subscriber does the
 * IO; every decision it makes is here.
 */

/** An inventory order is only ARRIVED once it says Delivered. */
export const MATERIAL_ARRIVED_STATUS = "Delivered"

/** The template key the arrival mail is sent with. */
export const MATERIAL_ARRIVED_TEMPLATE = "design-materials-delivered"

export type ArrivalEvent = {
  id?: string
  status?: string | null
  previous_status?: string | null
}

export type DesignAttachment = {
  design_id: string
  /** The typed column on the edge — NOT a flag in anyone's metadata. */
  notify_customer?: boolean | null
  /** When this design's customer was already told about THIS order. */
  notified_at?: string | Date | null
}

/**
 * Is this status change the arrival itself?
 *
 * ⚠️ The upstream event already fires only when the value actually moved, so
 * this cannot repeat while an order sits at Delivered. It says nothing about an
 * order corrected back to Shipped and delivered again — that is a second event
 * for one arrival, and `notified_at` is what stops it, not this.
 */
export const isArrival = (event: ArrivalEvent): boolean =>
  Boolean(event?.id) && String(event?.status ?? "") === MATERIAL_ARRIVED_STATUS

export type NoticeDecision =
  | { send: true; designIds: string[] }
  | { send: false; reason: "not_an_arrival" | "nothing_attached" | "all_suppressed_or_sent" }

/**
 * Which of the attached designs should have their customer told.
 *
 * 🔴 `notify_customer === false` SUPPRESSES; anything else sends. The default
 * has to be the sending one: a row written before the column existed, or by a
 * caller that never set it, reads as `null`/`undefined`, and treating that as
 * "do not tell them" would make the whole pipeline silently do nothing for
 * every pre-existing attachment — the failure mode this feature exists to end.
 *
 * 🔴 A design already notified for this order is dropped, not re-sent. The
 * arrival is one fact and a client should hear it once.
 */
export const decideArrivalNotice = (
  event: ArrivalEvent,
  attachments: DesignAttachment[]
): NoticeDecision => {
  if (!isArrival(event)) {
    return { send: false, reason: "not_an_arrival" }
  }
  if (!attachments.length) {
    return { send: false, reason: "nothing_attached" }
  }

  const designIds = attachments
    .filter((a) => a.notify_customer !== false)
    .filter((a) => !a.notified_at)
    .map((a) => a.design_id)
    .filter(Boolean)

  if (!designIds.length) {
    return { send: false, reason: "all_suppressed_or_sent" }
  }

  // One design may be attached to the same order twice through different rows.
  return { send: true, designIds: Array.from(new Set(designIds)) }
}
