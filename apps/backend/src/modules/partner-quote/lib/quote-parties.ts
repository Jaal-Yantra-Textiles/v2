import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../../platform-tax-identity"
import {
  resolvePlatformTaxIdentity,
  type PlatformTaxIdentityRow,
} from "../../platform-tax-identity/resolve-lib"

/**
 * Who is selling and who is buying, on the quote document.
 *
 * ## The seller is keyed on the ORIGIN, never on the buyer
 *
 * 🔴 This is the #348 defect and the #1447 defect, and they are the same shape:
 * a seller identity resolved from the CONSIGNEE's country put a Latvian company
 * number on an India-origin customs declaration, and a tax rate resolved from
 * the buyer's country put 19% German VAT on an Indian export. So the lookup key
 * here is the country the goods LEAVE from, which is the partner's (or the
 * house's) own jurisdiction.
 *
 * That is also what keeps KHT out of this path by construction. KHT Latvia is a
 * disclosed agent — it invoices on JYT's behalf while the goods ship direct
 * from India — and it is NOT VAT-registered. Naming it as the seller on a quote
 * to an EU buyer would be a false claim, and it can only happen if the lookup
 * is keyed on the destination. It is not.
 *
 * ## The buyer's number is RECORDED, not verified
 *
 * 🔑 Nothing here validates a VAT number against VIES, and the document must
 * not imply otherwise. A number shown under a heading that reads as though we
 * checked it is worse than no number: it invites a reverse-charge assumption
 * nobody is entitled to make. Callers render it as "as provided by the buyer".
 */

export type QuoteSellerParty = {
  legal_name: string | null
  tax_id: string | null
  tax_id_type: string | null
  /** "partner" when the partner's own registration; "platform" for the house. */
  source: "partner" | "platform" | null
  /** ISO-2 the identity was resolved FOR — the origin, not the destination. */
  origin_country_code: string | null
}

export type QuoteBuyerParty = {
  company: string | null
  contact_name: string | null
  tax_id: string | null
  tax_id_type: string | null
  /** Always false today. Present so a renderer cannot imply verification. */
  tax_id_verified: boolean
}

export type QuoteParties = {
  seller: QuoteSellerParty
  buyer: QuoteBuyerParty
}

/**
 * PURE: a tax id as it should be stored.
 *
 * Uppercased and stripped of WHITESPACE only. Buyers type "DE 123 456 789" and
 * "de123456789" for the same registration, and those must compare equal. But
 * punctuation is NOT stripped: an Indian PAN and several EU schemes carry
 * meaningful characters, and silently deleting them would store a number that
 * is not the one the buyer holds.
 */
export function normaliseTaxId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.replace(/\s+/g, "").toUpperCase()
  return cleaned.length ? cleaned : null
}

/** PURE: the seller block, from whichever identity applies. */
export function composeSellerParty(input: {
  partner?: { name?: string | null; tax_id?: string | null; tax_id_type?: string | null } | null
  platform?: PlatformTaxIdentityRow | null
  origin_country_code?: string | null
}): QuoteSellerParty {
  const origin = input.origin_country_code
    ? String(input.origin_country_code).trim().toUpperCase()
    : null

  const partnerTaxId = normaliseTaxId(input.partner?.tax_id ?? null)

  // The partner's OWN registration wins — the same precedence the carrier
  // label resolver locked on #348, so a partner is never billed under the
  // platform's number on one document and their own on another.
  if (partnerTaxId) {
    return {
      legal_name: input.partner?.name ?? null,
      tax_id: partnerTaxId,
      tax_id_type: input.partner?.tax_id_type ?? null,
      source: "partner",
      origin_country_code: origin,
    }
  }

  const platformTaxId = normaliseTaxId(input.platform?.tax_id ?? null)
  if (platformTaxId) {
    return {
      legal_name: input.platform?.legal_name ?? null,
      tax_id: platformTaxId,
      tax_id_type: input.platform?.tax_id_type ?? null,
      source: "platform",
      origin_country_code: origin,
    }
  }

  // 🔑 A named seller with no number, rather than nothing. "Who is selling"
  // and "under which registration" are two facts, and the first is still true
  // when the second is missing.
  return {
    legal_name: input.partner?.name ?? input.platform?.legal_name ?? null,
    tax_id: null,
    tax_id_type: null,
    source: null,
    origin_country_code: origin,
  }
}

/** PURE: the buyer block, straight off the quote row. */
export function composeBuyerParty(quote: any): QuoteBuyerParty {
  return {
    company: quote?.recipient_company ?? null,
    contact_name: quote?.recipient_name ?? null,
    tax_id: normaliseTaxId(quote?.buyer_tax_id ?? null),
    tax_id_type: quote?.buyer_tax_id_type ?? null,
    // Never true. See the header — nothing checks this against VIES or GSTN,
    // and a renderer must not be able to read a stored number as a checked one.
    tax_id_verified: false,
  }
}

/**
 * Resolve both parties for a quote.
 *
 * Never throws: a header block has no business turning a buyer's quote page
 * into a 500. Every failure degrades to the names we already hold.
 */
export async function resolveQuoteParties(
  scope: any,
  input: {
    quote: any
    partner_id?: string | null
    /** The country the goods ship FROM. See the header — this is the key. */
    origin_country_code?: string | null
  }
): Promise<QuoteParties> {
  const buyer = composeBuyerParty(input.quote)

  let partner: any = null
  let platform: PlatformTaxIdentityRow | null = null

  try {
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

    if (input.partner_id) {
      // Filtered by id — an unfiltered partner read on a public route is #1397.
      const { data } = await query.graph({
        entity: "partners",
        fields: ["id", "name", "tax_id", "tax_id_type"],
        filters: { id: input.partner_id },
      })
      partner = ((data ?? []) as any[])[0] ?? null
    }

    if (input.origin_country_code) {
      const { data } = await query.graph({
        entity: PLATFORM_TAX_IDENTITY_MODULE,
        fields: [
          "id",
          "brand_code",
          "legal_name",
          "tax_id",
          "tax_id_type",
          "country_codes",
          "is_active",
        ],
      })
      // Every row is listed and the PURE resolver skips the inactive ones —
      // boolean filters resolve unreliably across container scopes, which is
      // the same reason `seller-tax-id.ts` does it this way.
      platform = resolvePlatformTaxIdentity(
        input.origin_country_code,
        (data ?? []) as PlatformTaxIdentityRow[]
      )
    }
  } catch {
    // Fall through with whatever was resolved before the failure.
  }

  return {
    seller: composeSellerParty({
      partner,
      platform,
      origin_country_code: input.origin_country_code ?? null,
    }),
    buyer,
  }
}
