/**
 * #2138 — what a LIVE photo context actually causes to happen.
 *
 * ## The gap this closes
 *
 * #2143 let an admin say what photos will be for, in the same breath as asking
 * for them. It stamps `photo_context` on the conversation. Nothing then READ
 * it: the message handler used the context only to decide *not* to batch the
 * photo, and the arriving photo fell through to the ordinary shared-folder
 * reply. A context that has been set and never acted on is worse than none —
 * the admin believes the photos are being filed under the purpose they stated.
 *
 * 🔴 And `photo_purpose` — the value the product-create flow's eligibility rule
 * tests — was set NOWHERE. `whatsapp.message_received` is emitted from the
 * webhook with no such key, so `$trigger.photo_purpose === 'product_submission'`
 * could never be true. Photo→product creation has been off since #2139 replaced
 * the caption rule, and merging the admin-context PR did not turn it back on,
 * because the context never reached the event.
 *
 * ## Why an unknown kind falls back to ASKING
 *
 * The one outcome that must not happen is a photo disappearing quietly. A kind
 * this module does not recognise — an older context written before a rename, a
 * hand-edited metadata blob — returns null, which puts the photo back on the
 * batch-and-ask path. Silence is the failure mode #2138 exists to remove, so
 * nothing here may produce it.
 */

import {
  PHOTO_CONTEXT_KINDS,
  type PhotoContextKind,
} from "./whatsapp-photo-context"
import { isPhotoContextLive, type PhotoContext } from "./whatsapp-photo-batch"

export type PhotoContextAction = {
  kind: PhotoContextKind
  /**
   * The value stamped onto the `whatsapp.message_received` event, which is what
   * the product-create flow's eligibility rule reads.
   */
  photo_purpose: PhotoContextKind
  /**
   * Run a textile analysis on the image and file it as `partner_upload`.
   *
   * Only for `inventory_offer`: the partner is offering us material, so what
   * the cloth IS becomes a fact worth keeping against the media. For the other
   * kinds the analysis would be a guess nobody asked for.
   */
  analyse: boolean
  /**
   * Who sends the reply. `flow` means the visual flow owns it — replying here
   * too would send the partner two messages for one photo, which is the exact
   * double-reply the caption branch already guards against.
   */
  reply: "here" | "flow"
  /** What we say, when we own the reply. Null when the flow does. */
  confirmation: string | null
}

/**
 * PURE: given the conversation's stored context, what should this photo cause?
 *
 * Returns null when there is no live context, or when its kind is not one we
 * recognise — both of which mean "fall through to batch-and-ask".
 */
export function resolveLivePhotoContextAction(
  ctx: PhotoContext | null | undefined,
  now: Date = new Date()
): PhotoContextAction | null {
  if (!isPhotoContextLive(ctx, now)) {
    return null
  }
  const kind = ctx!.kind as PhotoContextKind
  if (!Object.prototype.hasOwnProperty.call(PHOTO_CONTEXT_KINDS, kind)) {
    return null
  }

  switch (kind) {
    case "inventory_offer":
      return {
        kind,
        photo_purpose: kind,
        analyse: true,
        reply: "here",
        confirmation:
          "✅ Thanks — saved against what you're offering us. Our team will look at the material and come back to you.",
      }
    case "product_submission":
      // The flow answers with "Draft product created". Two replies for one
      // photo is the defect the caption branch already exists to prevent.
      return {
        kind,
        photo_purpose: kind,
        analyse: false,
        reply: "flow",
        confirmation: null,
      }
    case "run_progress":
      return {
        kind,
        photo_purpose: kind,
        analyse: false,
        reply: "here",
        confirmation: "✅ Thanks — saved as progress on the work you're making for us.",
      }
  }
}

/**
 * PURE: the `photo_purpose` to stamp on the outbound event, or null.
 *
 * Split from the action so the webhook — which knows nothing about replies or
 * analyses — can ask the single question it has: what are these photos for?
 */
export function resolvePhotoPurpose(
  ctx: PhotoContext | null | undefined,
  now: Date = new Date()
): PhotoContextKind | null {
  return resolveLivePhotoContextAction(ctx, now)?.photo_purpose ?? null
}
