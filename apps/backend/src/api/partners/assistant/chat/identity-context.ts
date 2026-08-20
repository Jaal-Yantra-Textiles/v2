import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Who the partner is and which stores they have — resolved SERVER-SIDE, once
 * per turn, and handed to the model in the system prompt (#1392).
 *
 * ## Why this exists
 *
 * The assistant was rediscovering its own caller. Every conversation, and often
 * several times within one, the model would call `list_stores` /
 * `get_partner_profile` to answer a question it could not act on without: which
 * store am I writing to, what currency is it in, which sales channel.
 *
 * That is a strange thing to make a language model figure out. The request is
 * already authenticated as this partner — the server knows the answer before
 * the model has read the first token. Leaving it to a tool call costs a round
 * trip, spends context on a payload the model then has to re-read every turn,
 * and — worst — is *unreliable*: a model that forgets to look ends up asking
 * the partner which store they mean, about a partner who only has one.
 *
 * So this is deliberately NOT a cache. `lib/assistant-context` already caches
 * what the model *found*; this states what the server *knows*. A cache can miss
 * and can go stale. This is recomputed every turn from one query and cannot be
 * either.
 *
 * ## Scope, deliberately narrow
 *
 * Identity and stores only. Not orders, not products, not counts. The value
 * here comes from being small enough to sit in every system prompt without
 * argument; the moment it grows into a business summary it becomes a thing
 * whose staleness matters, and it stops being free.
 */

export type PartnerIdentityStore = {
  id: string
  name?: string | null
  default_sales_channel_id?: string | null
  default_location_id?: string | null
  default_currency_code?: string | null
}

export type PartnerIdentity = {
  id: string
  name?: string | null
  handle?: string | null
  workspace_type?: string | null
  is_verified?: boolean | null
  country_code?: string | null
  stores: PartnerIdentityStore[]
}

/**
 * One graph call. Failure returns `null` rather than throwing: this only ever
 * saves the model a lookup it can still perform itself, so it must never be
 * able to fail the turn — the same rule the prior-context cache follows.
 */
export const resolvePartnerIdentity = async (
  container: any,
  partnerId: string | null | undefined,
  logger?: { warn: (m: string) => void }
): Promise<PartnerIdentity | null> => {
  if (!partnerId) return null

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "handle",
        "workspace_type",
        "is_verified",
        "country_code",
        "stores.id",
        "stores.name",
        "stores.default_sales_channel_id",
        "stores.default_location_id",
        "stores.default_currency_code",
      ],
      filters: { id: partnerId },
    })

    const partner = data?.[0]
    if (!partner) return null

    return {
      id: partner.id,
      name: partner.name,
      handle: partner.handle,
      workspace_type: partner.workspace_type,
      is_verified: partner.is_verified,
      country_code: partner.country_code,
      stores: ((partner as any).stores ?? []).map((s: any) => ({
        id: s?.id,
        name: s?.name,
        default_sales_channel_id: s?.default_sales_channel_id,
        default_location_id: s?.default_location_id,
        default_currency_code: s?.default_currency_code,
      })).filter((s: PartnerIdentityStore) => !!s.id),
    }
  } catch (e: any) {
    logger?.warn(
      `[partner-assistant] identity context unavailable: ${e?.message ?? e}`
    )
    return null
  }
}

/**
 * Render the block that goes into the system prompt.
 *
 * Pure, so the wording is unit-testable without a container — the wording is
 * the whole mechanism here, and a block the model does not trust is a block it
 * calls `list_stores` anyway.
 */
export const formatPartnerIdentityBlock = (
  identity: PartnerIdentity | null
): string | undefined => {
  if (!identity) return undefined

  const lines: string[] = []
  lines.push("## Who you are talking to (already resolved — do not look it up)")
  lines.push("")
  lines.push(
    "This is established from the authenticated request, not from a tool call. It is current as of this turn."
  )
  lines.push("")

  const bits = [`id: ${identity.id}`]
  if (identity.name) bits.push(`name: ${identity.name}`)
  if (identity.handle) bits.push(`handle: ${identity.handle}`)
  if (identity.workspace_type) bits.push(`type: ${identity.workspace_type}`)
  if (identity.country_code) bits.push(`country: ${identity.country_code}`)
  if (identity.is_verified != null)
    bits.push(`verified: ${identity.is_verified ? "yes" : "no"}`)
  lines.push(`Partner — ${bits.join(", ")}`)

  if (!identity.stores.length) {
    lines.push("")
    lines.push(
      "Stores — NONE. This partner has no store yet, so catalogue and storefront tools have nothing to write to. Say so plainly rather than calling `list_stores` to confirm it."
    )
  } else if (identity.stores.length === 1) {
    const s = identity.stores[0]
    lines.push("")
    lines.push(
      `Store — ${s.name ?? "(unnamed)"} (id: ${s.id}${
        s.default_currency_code ? `, currency: ${s.default_currency_code}` : ""
      }${
        s.default_sales_channel_id
          ? `, sales channel: ${s.default_sales_channel_id}`
          : ""
      }${
        s.default_location_id ? `, stock location: ${s.default_location_id}` : ""
      })`
    )
    lines.push("")
    lines.push(
      "🔑 There is exactly ONE store. Use this id for every store-scoped tool WITHOUT asking which store the partner means, and without calling `list_stores` first — asking a partner to choose between one option reads as not knowing who they are."
    )
  } else {
    lines.push("")
    lines.push(`Stores — ${identity.stores.length}:`)
    for (const s of identity.stores) {
      lines.push(
        `  - ${s.name ?? "(unnamed)"} (id: ${s.id}${
          s.default_currency_code ? `, ${s.default_currency_code}` : ""
        })`
      )
    }
    lines.push("")
    lines.push(
      "🔑 More than one store, so a store-scoped write DOES need the partner to say which — but ask them by NAME from this list. Do not call `list_stores` to rebuild it."
    )
  }

  lines.push("")
  lines.push(
    "Carry these ids across the whole conversation. Re-fetching identity you were already given is a wasted turn the partner waits through."
  )

  return lines.join("\n")
}
