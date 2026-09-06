import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { GraphBuilder, asArray } from "../../builder"
import type { Graph, GraphNode, SpineContext, SpineDescriptor } from "../../types"
import { erroredBindings, neverSynced, type BindingLike } from "./absence"
import { SOCIAL_PLATFORM_ITEM_NODES, resolveSocialPlatformItems } from "./items"

/**
 * The SOCIAL PLATFORM spine (#1855) — the marketing surface.
 *
 * A platform is the marketing side's biggest node: posts, campaigns, ad
 * accounts, leads and integration bindings all hang off it, the way work hangs
 * off a partner.
 *
 * 🔴 It asserts exactly ONE fault, and everything else is a present-only node.
 * The local database has zero social posts, zero publishing campaigns, zero
 * leads and zero ad campaigns — so the obvious rules (a scheduled post whose
 * time has passed; a post marked `posted` with no `post_url`) could not be run
 * against a single real row. See `absence.ts` for why they were deferred
 * rather than shipped on a test fixture's word.
 *
 * The one that IS here fires on 49 real bindings.
 */
const resolveSocialPlatformGraph = async ({
  scope,
  id,
}: SpineContext): Promise<Graph> => {
  const platformId = id
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

  /*
   * Every neighbour here is an intra-module `hasMany` on the platform model,
   * so they resolve straight off the entity — no link tables, and therefore
   * none of the `entryPoint` / `resolveExisting` treatment the design and
   * partner spines need.
   */
  const { data: platforms } = await query.graph({
    entity: "social_platforms",
    filters: { id: platformId },
    fields: ["*", "posts.*", "bindings.*", "ad_accounts.*", "leads.*"],
  })

  const platform = (platforms || [])[0]
  if (!platform) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Social platform ${platformId} was not found`
    )
  }

  const posts = asArray<any>(platform.posts)
  const bindings = asArray<any>(platform.bindings)
  const adAccounts = asArray<any>(platform.ad_accounts)
  const leads = asArray<any>(platform.leads)

  const { data: campaigns } = await query.graph({
    entity: "publishing_campaigns",
    filters: { platform_id: platformId },
    fields: ["*"],
  })
  const campaignList = asArray<any>(campaigns)

  const bindingLikes: BindingLike[] = bindings.map((b) => ({
    id: String(b.id),
    status: b.status,
    last_synced_at: b.last_synced_at,
    last_error: b.last_error,
  }))
  const dormant = neverSynced(bindingLikes)
  const errored = erroredBindings(bindingLikes)

  const builder = new GraphBuilder("social_platform")
  const push = builder.push.bind(builder)

  // ---- bindings: the one asserted fault -----------------------------------

  if (bindings.length) {
    /*
     * 🔴 `derived`, not `absent`. The neighbour is not missing — it is there,
     * switched on, and inert. `status = "active"` is set at CREATION and is
     * what every screen reads to decide an integration is connected, so a
     * binding that has never synced once is indistinguishable from one syncing
     * every hour. Measured: all 49 on the local database are in that state.
     */
    const broken = dormant.length + errored.length
    push(
      {
        key: "bindings",
        type: "social_platform_binding",
        label: "Integrations",
        sublabel: broken
          ? `${dormant.length} never synced${errored.length ? `, ${errored.length} errored` : ""}`
          : `${bindings.length} connected`,
        state: broken ? "derived" : "present",
        count: bindings.length,
        status: broken ? "inert" : null,
        href: null,
        props: [
          { key: "bindings", value: String(bindings.length) },
          { key: "never synced", value: String(dormant.length) },
          { key: "errored", value: String(errored.length) },
        ],
        action: null,
      },
      {
        label: "platform_id",
        state: broken ? "derived" : "present",
        reason: broken
          ? `${dormant.length} of ${bindings.length} integration${bindings.length === 1 ? "" : "s"} ${dormant.length === 1 ? "is" : "are"} marked active and ${dormant.length === 1 ? "has" : "have"} never synced. ${dormant.length === 1 ? "It reads" : "They read"} as connected everywhere the status is shown, and no data has ever come back from ${dormant.length === 1 ? "it" : "them"}.`
          : null,
      }
    )
  }

  // ---- the rest: present only ---------------------------------------------

  if (posts.length) {
    const byStatus = posts.reduce<Record<string, number>>((acc, p) => {
      const k = String(p.status ?? "unknown")
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    push(
      {
        key: "posts",
        type: "social_post",
        label: "Posts",
        sublabel: `${posts.length} post${posts.length === 1 ? "" : "s"}`,
        state: "present",
        count: posts.length,
        status: null,
        href: `/social-posts`,
        props: Object.entries(byStatus).map(([k, v]) => ({
          key: k,
          value: String(v),
        })),
        action: null,
      },
      { label: "platform_id", state: "present", reason: null }
    )
  }

  if (campaignList.length) {
    const byStatus = campaignList.reduce<Record<string, number>>((acc, c) => {
      const k = String(c.status ?? "unknown")
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    push(
      {
        key: "campaigns",
        type: "publishing_campaign",
        label: "Campaigns",
        sublabel: `${campaignList.length} campaign${campaignList.length === 1 ? "" : "s"}`,
        state: "present",
        count: campaignList.length,
        status: null,
        href: `/publishing-campaigns`,
        props: Object.entries(byStatus).map(([k, v]) => ({
          key: k,
          value: String(v),
        })),
        action: null,
      },
      { label: "platform_id", state: "present", reason: null }
    )
  }

  if (adAccounts.length) {
    push(
      {
        key: "ad_accounts",
        type: "ad_account",
        label: "Ad accounts",
        sublabel: `${adAccounts.length} account${adAccounts.length === 1 ? "" : "s"}`,
        state: "present",
        count: adAccounts.length,
        status: null,
        href: null,
        props: [{ key: "accounts", value: String(adAccounts.length) }],
        action: null,
      },
      { label: "platform_id", state: "present", reason: null }
    )
  }

  if (leads.length) {
    push(
      {
        key: "leads",
        type: "lead",
        label: "Leads",
        sublabel: `${leads.length} lead${leads.length === 1 ? "" : "s"}`,
        state: "present",
        count: leads.length,
        status: null,
        href: null,
        props: [{ key: "leads", value: String(leads.length) }],
        action: null,
      },
      { label: "platform_id", state: "present", reason: null }
    )
  }

  const spine: GraphNode = {
    key: "social_platform",
    type: "social_platform",
    label: String(platform.name ?? platformId),
    sublabel: String(platform.category ?? ""),
    state: "present",
    count: 1,
    status: String(platform.status ?? ""),
    href: null,
    props: [
      { key: "status", value: String(platform.status ?? "—") },
      { key: "category", value: String(platform.category ?? "—") },
      { key: "auth", value: String(platform.auth_type ?? "—") },
    ],
    action: null,
  }

  return builder.build(spine)
}

export const socialPlatformSpine: SpineDescriptor = {
  key: "social_platform",
  label: "Social platform",
  resolve: resolveSocialPlatformGraph,
  items: resolveSocialPlatformItems,
  itemNodes: SOCIAL_PLATFORM_ITEM_NODES,
}
