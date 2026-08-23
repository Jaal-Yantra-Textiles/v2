import { FetchError } from "@medusajs/js-sdk"
import { useQuery, keepPreviousData } from "@tanstack/react-query"

import { sdk } from "../../lib/config"

/**
 * The three lists the mint wizard's Buyer step picks from (#1439 S4).
 *
 * ## Why regions, and not a free-text currency box
 *
 * The wizard used to ask for a currency and a destination country as two
 * independent text inputs, which let an operator quote INR to a GB address —
 * a combination no region supports, so the mint priced against nothing and the
 * preflight refused it after the fact. A region carries BOTH facts, so picking
 * one infers the currency and narrows the countries to those it actually
 * covers. The impossible combination stops being expressible.
 *
 * ## Why two buyer lists rather than one
 *
 * A quote's buyer is resolved BY EMAIL at mint, so anything with an email is a
 * valid starting point. Existing customers are the obvious source; CRM persons
 * are the one that matters commercially, because a B2B quote is usually the
 * FIRST thing a lead ever receives — they are not a customer yet, and requiring
 * them to be one would mean typing the address by hand and risking a
 * near-duplicate on a typo.
 */

export type QuoteRegionOption = {
  id: string
  name: string
  currency_code: string
  /** ISO-2, lower-case. Empty when the region declares no countries. */
  countries: string[]
}

export const useQuoteRegions = () => {
  const { data, ...rest } = useQuery<{ regions: any[] }, FetchError>({
    queryFn: () => sdk.admin.region.list({ limit: 100, fields: "id,name,currency_code,countries.iso_2" }) as any,
    queryKey: ["quote-wizard-regions"],
    placeholderData: keepPreviousData,
  })

  const regions: QuoteRegionOption[] = (data?.regions ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    currency_code: String(r.currency_code || "").toLowerCase(),
    countries: (r.countries ?? [])
      .map((c: any) => String(c?.iso_2 || "").toLowerCase())
      .filter(Boolean),
  }))

  return { regions, ...rest }
}

export type QuoteBuyerOption = {
  /** The email IS the identity here — the mint resolves the buyer by it. */
  email: string
  label: string
  company: string | null
  name: string | null
  source: "customer" | "lead"
}

const personName = (p: any): string | null =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") || null

/**
 * Existing customers and CRM people, merged and de-duplicated by email.
 *
 * 🔑 De-duplicated with the CUSTOMER winning. The same human is often both, and
 * showing one address twice under two labels invites an operator to wonder
 * which one is "the real" record — there is no such distinction at mint, which
 * matches on the address alone.
 *
 * A person with no email is dropped rather than listed as unselectable: the
 * only thing this picker produces is an email, so a row that cannot produce
 * one is not a choice.
 */
export const useQuoteBuyerOptions = (search: string) => {
  const query = search ? { q: search } : {}

  const customers = useQuery<{ customers: any[] }, FetchError>({
    queryFn: () => sdk.admin.customer.list({ limit: 20, ...query }) as any,
    queryKey: ["quote-wizard-customers", search],
    placeholderData: keepPreviousData,
  })

  const persons = useQuery<{ persons: any[] }, FetchError>({
    queryFn: () =>
      sdk.client.fetch<{ persons: any[] }>("/admin/persons", {
        method: "GET",
        query: { limit: 20, ...query },
      }),
    queryKey: ["quote-wizard-persons", search],
    placeholderData: keepPreviousData,
  })

  const byEmail = new Map<string, QuoteBuyerOption>()

  for (const p of persons.data?.persons ?? []) {
    const email = String(p?.email || "").trim().toLowerCase()
    if (!email) continue
    byEmail.set(email, {
      email,
      label: [email, personName(p)].filter(Boolean).join(" · "),
      company: p?.company_name ?? null,
      name: personName(p),
      source: "lead",
    })
  }

  // Second, so a customer overwrites the CRM row for the same address.
  for (const c of customers.data?.customers ?? []) {
    const email = String(c?.email || "").trim().toLowerCase()
    if (!email) continue
    byEmail.set(email, {
      email,
      label: [email, personName(c)].filter(Boolean).join(" · "),
      company: c?.company_name ?? null,
      name: personName(c),
      source: "customer",
    })
  }

  return {
    options: [...byEmail.values()],
    isLoading: customers.isLoading || persons.isLoading,
  }
}

/**
 * The carriers this partner can actually be quoted against (#1447).
 *
 * 🔑 Reads `/admin/shipping-carriers`, the SAME availability builder the
 * carrier settings screen uses, rather than a hand-written list. A second list
 * of "which carriers exist" drifts the first time one gains credentials, and
 * the drift shows up as a quote priced against a carrier this deployment cannot
 * call — which fails as a fallback rate, silently, not as an error.
 *
 * Gated on `partner_id` because availability is per-partner: it is read from
 * that partner's stock location links. No partner picked yet ⇒ no query.
 */
export type QuoteCarrierOption = {
  id: string
  label: string
  /** Selectable — integrated, registered on this deployment, linked here. */
  available: boolean
  /** Why not, when it is not. Rendered so a disabled row explains itself. */
  blocked_reason: string | null
  /** Can this carrier be TOLD the shipment is DDP (#1447)? */
  can_declare_ddp: boolean
}

export const useQuoteCarriers = (partnerId?: string | null) => {
  const { data, ...rest } = useQuery<
    { carriers: any[]; origin_country_code?: string | null },
    FetchError
  >({
    queryFn: () =>
      sdk.client.fetch<{ carriers: any[]; origin_country_code?: string | null }>("/admin/shipping-carriers", {
        method: "GET",
        query: { partner_id: partnerId },
      }),
    queryKey: ["quote-wizard-carriers", partnerId],
    enabled: Boolean(partnerId),
    placeholderData: keepPreviousData,
  })

  const options: QuoteCarrierOption[] = (data?.carriers ?? [])
    .filter((c: any) => c?.integrated)
    .map((c: any) => ({
      id: String(c.id),
      label: String(c.label ?? c.id),
      // `enabled` is the location link — the partner's own selection. A
      // registered-but-unlinked carrier is deliberately still offered here:
      // a quote is not a shipment, and refusing to PRICE against a carrier
      // someone is about to link is a worse failure than an unusual pick.
      available: Boolean(c.registered),
      blocked_reason: c.blocked_reason ?? null,
      can_declare_ddp: Boolean(c.can_declare_ddp),
    }))

  return {
    options,
    /**
     * Where this partner's goods dispatch from (#1447). Null is UNKNOWN, never
     * "domestic" — treating an unreadable origin as domestic would hide the DDP
     * question on a real export, which is the direction that costs a buyer a
     * customs bill they were told would not come.
     */
    originCountryCode: data?.origin_country_code ?? null,
    ...rest,
  }
}
