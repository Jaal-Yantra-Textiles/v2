import { MedusaError } from "@medusajs/framework/utils"

import { digitsOnly, phoneMatches } from "../whatsapp/whatsapp-phone"

/**
 * #2350 — one WhatsApp number belongs to ONE partner.
 *
 * Inbound messages are routed by matching the sender against
 * `partner.whatsapp_number`, so a number stored on two partners makes every
 * outbound alert for either go to the same phone and every reply from it act for
 * whichever partner the match finds first. On 2026-10-05 Embroprint was
 * connected to Lucknavi boutique's number: two Embroprint job alerts reached
 * Lucknavi's owner, and the real Embroprint got neither. Nothing refused it.
 */

export type WhatsappNumberHolder = {
  id: string
  name?: string | null
  whatsapp_number?: string | null
}

/**
 * Below this many digits a suffix match is meaningless (`phoneMatches` matches
 * `9876543210` against `919876543210` on purpose, so a 3-digit fragment would
 * "match" thousands of numbers). Indian mobiles are 10 digits without the code.
 */
const MIN_COMPARABLE_DIGITS = 10

/** Partners other than `excludePartnerId` whose stored WhatsApp number is this phone. */
export function partnersHoldingNumber<T extends WhatsappNumberHolder>(
  partners: T[],
  phone: string,
  excludePartnerId?: string | null
): T[] {
  const target = digitsOnly(phone)
  if (target.length < MIN_COMPARABLE_DIGITS) return []
  return partners.filter((p) => {
    if (p.id === excludePartnerId) return false
    const held = digitsOnly(p.whatsapp_number)
    return held.length >= MIN_COMPARABLE_DIGITS && phoneMatches(held, target)
  })
}

/**
 * Refuse a number another partner already holds — before it is saved, and
 * before any WhatsApp is sent to it.
 *
 * `audience: "partner"` keeps the other partner's name out of the message: a
 * partner typing a number must not learn who else is on the platform.
 */
export async function assertWhatsappNumberFree(
  partnerService: any,
  phone: string,
  partnerId: string,
  audience: "admin" | "partner" = "admin"
): Promise<void> {
  const [partners] = await partnerService.listAndCountPartners(
    {},
    { take: 1000, select: ["id", "name", "whatsapp_number"] }
  )
  const holders = partnersHoldingNumber(partners || [], phone, partnerId)
  if (!holders.length) return

  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    audience === "admin"
      ? `WhatsApp number ${digitsOnly(phone)} already belongs to ${holders
          .map((h) => `${h.name || "a partner"} (${h.id})`)
          .join(", ")}. One number can belong to one partner only — check the number, or disconnect it from that partner first.`
      : "This WhatsApp number is already linked to another account. Please use a different number or contact JYT."
  )
}
