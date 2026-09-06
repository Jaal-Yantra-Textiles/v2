import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { asArray } from "../../builder"
import type { NodeItem, SpineContext } from "../../types"
import { erroredBindings, neverSynced, type BindingLike } from "./absence"

/**
 * The members behind a social platform's nodes (#1855).
 *
 * No `remove` anywhere: a post, a campaign and an ad account each have their
 * own lifecycle route, and a binding is an OAuth connection whose removal is a
 * disconnection, not an unlink.
 */

const loadPlatform = async (query: any, platformId: string) => {
  const { data } = await query.graph({
    entity: "social_platforms",
    filters: { id: platformId },
    fields: ["id", "posts.*", "bindings.*", "ad_accounts.*", "leads.*"],
  })
  return (data || [])[0]
}

const bindingItems = async (
  query: any,
  platformId: string
): Promise<NodeItem[]> => {
  const platform = await loadPlatform(query, platformId)
  const raw = asArray<any>(platform?.bindings)
  const likes: BindingLike[] = raw.map((b) => ({
    id: String(b.id),
    status: b.status,
    last_synced_at: b.last_synced_at,
    last_error: b.last_error,
  }))
  const dormantIds = new Set(neverSynced(likes).map((b) => b.id))
  const erroredIds = new Set(erroredBindings(likes).map((b) => b.id))

  /*
   * 🔴 The broken ones first. This node is only ever opened because it says
   * some integrations never synced, and on a platform with 49 bindings an
   * insertion-ordered list buries them among the healthy ones — the reader
   * would scroll past the answer looking for it.
   */
  const rank = (id: string) =>
    erroredIds.has(id) ? 0 : dormantIds.has(id) ? 1 : 2

  return [...raw]
    .sort((a, b) => rank(String(a.id)) - rank(String(b.id)))
    .map((b) => {
      const id = String(b.id)
      const dormant = dormantIds.has(id)
      const errored = erroredIds.has(id)
      return {
        id,
        label: String(b.resource_label ?? b.resource_id ?? id),
        sublabel:
          [
            b.service ? String(b.service) : null,
            errored
              ? String(b.last_error ?? "errored").slice(0, 80)
              : dormant
                ? "never synced"
                : b.last_synced_at
                  ? `synced ${new Date(b.last_synced_at).toLocaleDateString()}`
                  : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        status: b.status ? String(b.status) : null,
        href: null,
        props: [
          ...(b.service ? [{ key: "service", value: String(b.service) }] : []),
          ...(b.resource_id
            ? [{ key: "resource", value: String(b.resource_id) }]
            : []),
          {
            key: "last synced",
            value: b.last_synced_at
              ? new Date(b.last_synced_at).toLocaleString()
              : "never",
          },
          ...(b.last_error ? [{ key: "error", value: String(b.last_error) }] : []),
        ],
        remove: null,
      }
    })
}

const postItems = async (query: any, platformId: string): Promise<NodeItem[]> => {
  const platform = await loadPlatform(query, platformId)
  return asArray<any>(platform?.posts).map((p) => ({
    id: String(p.id),
    label: String(p.name ?? p.id),
    sublabel:
      [
        p.scheduled_at
          ? `scheduled ${new Date(p.scheduled_at).toLocaleDateString()}`
          : null,
        p.posted_at ? `posted ${new Date(p.posted_at).toLocaleDateString()}` : null,
        p.error_message ? String(p.error_message).slice(0, 60) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    status: p.status ? String(p.status) : null,
    href: `/social-posts/${p.id}`,
    props: [
      { key: "status", value: String(p.status ?? "—") },
      ...(p.post_url ? [{ key: "url", value: String(p.post_url) }] : []),
      ...(p.error_message
        ? [{ key: "error", value: String(p.error_message) }]
        : []),
    ],
    remove: null,
  }))
}

const campaignItems = async (
  query: any,
  platformId: string
): Promise<NodeItem[]> => {
  const { data } = await query.graph({
    entity: "publishing_campaigns",
    filters: { platform_id: platformId },
    fields: ["*"],
  })
  return asArray<any>(data).map((c) => {
    const items = Array.isArray(c.items) ? c.items.length : 0
    return {
      id: String(c.id),
      label: String(c.name ?? c.id),
      sublabel:
        [
          items ? `${c.current_index ?? 0} of ${items}` : null,
          c.error_message ? String(c.error_message).slice(0, 60) : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      status: c.status ? String(c.status) : null,
      href: `/publishing-campaigns/${c.id}`,
      props: [
        { key: "status", value: String(c.status ?? "—") },
        { key: "progress", value: `${c.current_index ?? 0} of ${items}` },
        { key: "interval", value: `${c.interval_hours ?? "—"}h` },
        ...(c.error_message
          ? [{ key: "error", value: String(c.error_message) }]
          : []),
      ],
      remove: null,
    }
  })
}

const adAccountItems = async (
  query: any,
  platformId: string
): Promise<NodeItem[]> => {
  const platform = await loadPlatform(query, platformId)
  return asArray<any>(platform?.ad_accounts).map((a) => ({
    id: String(a.id),
    label: String(a.name ?? a.account_id ?? a.id),
    sublabel: a.currency ? String(a.currency).toUpperCase() : null,
    status: a.status ? String(a.status) : null,
    href: null,
    props: [
      ...(a.account_id ? [{ key: "account", value: String(a.account_id) }] : []),
    ],
    remove: null,
  }))
}

const leadItems = async (query: any, platformId: string): Promise<NodeItem[]> => {
  const platform = await loadPlatform(query, platformId)
  return asArray<any>(platform?.leads).map((l) => ({
    id: String(l.id),
    label: String(l.full_name ?? l.email ?? l.id),
    sublabel: l.email ? String(l.email) : null,
    status: l.status ? String(l.status) : null,
    href: null,
    props: [...(l.email ? [{ key: "email", value: String(l.email) }] : [])],
    remove: null,
  }))
}

const RESOLVERS: Record<
  string,
  (query: any, platformId: string) => Promise<NodeItem[]>
> = {
  bindings: bindingItems,
  posts: postItems,
  campaigns: campaignItems,
  ad_accounts: adAccountItems,
  leads: leadItems,
}

export const SOCIAL_PLATFORM_ITEM_NODES = Object.keys(RESOLVERS)

export const resolveSocialPlatformItems = async (
  { scope, id }: SpineContext,
  nodeKey: string
): Promise<NodeItem[]> => {
  const resolver = RESOLVERS[nodeKey]
  if (!resolver) {
    return []
  }
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
  return resolver(query, id)
}
