import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { asArray } from "../../builder"
import type { NodeItem, SpineContext } from "../../types"
import {
  emptyPublishedPages,
  failedSends,
  newslettersAwaitingSend,
  type PageLike,
} from "./absence"

/**
 * The members behind a website's aggregate nodes (#1855).
 *
 * 🔴 The three ABSENT nodes list rows too, and that is the point of them here.
 * "3 newsletters never sent" provokes exactly one question — WHICH three — and
 * on this spine the answer is the whole value: each row is a piece of finished
 * work that needs one action. The design spine's absent nodes had nothing to
 * enumerate; these do.
 *
 * No `remove` anywhere. Deleting a page is a content decision with its own
 * route and its own cascade (`delete: ['blocks', 'subscription_send_logs']` on
 * the model), and a bin icon beside a row that reads "published, never sent"
 * would sit one pixel from the action the reader actually wants.
 */

/** Everything the item resolvers need, in one read. */
const loadPages = async (query: any, websiteId: string) => {
  const { data } = await query.graph({
    entity: "websites",
    filters: { id: websiteId },
    fields: [
      "id",
      "pages.*",
      "pages.blocks.*",
      "pages.subscription_send_logs.*",
      "domains.*",
    ],
  })
  return (data || [])[0]
}

const toPageLike = (p: any): PageLike => ({
  id: String(p.id),
  status: p.status,
  page_type: p.page_type,
  content: p.content,
  sent_to_subscribers: p.sent_to_subscribers,
  block_count: asArray<any>(p.blocks).length,
})

const pageRow = (p: any, websiteId: string, sublabel: string | null): NodeItem => ({
  id: String(p.id),
  label: String(p.title ?? p.slug ?? p.id),
  sublabel,
  status: p.status ? String(p.status) : null,
  href: `/websites/${websiteId}/pages/${p.id}`,
  props: [
    ...(p.page_type ? [{ key: "type", value: String(p.page_type) }] : []),
    ...(p.slug ? [{ key: "slug", value: String(p.slug) }] : []),
    { key: "blocks", value: String(asArray<any>(p.blocks).length) },
  ],
  remove: null,
})

const pageItems = async (query: any, websiteId: string): Promise<NodeItem[]> => {
  const website = await loadPages(query, websiteId)
  return asArray<any>(website?.pages).map((p) =>
    pageRow(
      p,
      websiteId,
      /*
       * 🔴 Never the status — the row renders that as a badge already, and
       * printing it twice was the fault the design spine's rows shipped with
       * until they were looked at.
       */
      [p.page_type, p.slug ? `/${p.slug}` : null].filter(Boolean).join(" · ") || null
    )
  )
}

const publishedItems = async (
  query: any,
  websiteId: string
): Promise<NodeItem[]> => {
  // The `published` node fires only when NONE are published, so its rows are
  // the drafts — the things one action away from fixing it.
  const website = await loadPages(query, websiteId)
  return asArray<any>(website?.pages)
    .filter((p) => String(p.status) !== "Published")
    .map((p) => pageRow(p, websiteId, "not published"))
}

const newsletterItems = async (
  query: any,
  websiteId: string
): Promise<NodeItem[]> => {
  const website = await loadPages(query, websiteId)
  const raw = asArray<any>(website?.pages)
  const unsent = new Set(
    newslettersAwaitingSend(raw.map(toPageLike)).map((p) => p.id)
  )
  return raw
    .filter((p) => unsent.has(String(p.id)))
    .map((p) => pageRow(p, websiteId, "published, never sent"))
}

const emptyPageItems = async (
  query: any,
  websiteId: string
): Promise<NodeItem[]> => {
  const website = await loadPages(query, websiteId)
  const raw = asArray<any>(website?.pages)
  const empty = new Set(emptyPublishedPages(raw.map(toPageLike)).map((p) => p.id))
  return raw
    .filter((p) => empty.has(String(p.id)))
    .map((p) => pageRow(p, websiteId, "no blocks, no body"))
}

const blockItems = async (query: any, websiteId: string): Promise<NodeItem[]> => {
  const website = await loadPages(query, websiteId)
  return asArray<any>(website?.pages).flatMap((p) =>
    asArray<any>(p.blocks).map((b) => ({
      id: String(b.id),
      label: String(b.name ?? b.type ?? b.id),
      // Which PAGE it is on — the one fact that tells two blocks of the same
      // type apart when they are listed together across a whole website.
      sublabel: `${p.title ?? p.slug ?? "page"}${b.type ? ` · ${b.type}` : ""}`,
      status: b.status ? String(b.status) : null,
      href: `/websites/${websiteId}/pages/${p.id}`,
      props: [
        ...(b.type ? [{ key: "type", value: String(b.type) }] : []),
        { key: "order", value: String(b.order ?? 0) },
      ],
      remove: null,
    }))
  )
}

const domainItems = async (query: any, websiteId: string): Promise<NodeItem[]> => {
  const website = await loadPages(query, websiteId)
  return asArray<any>(website?.domains).map((d) => ({
    id: String(d.id),
    label: String(d.domain ?? d.id),
    sublabel: d.is_primary ? "primary" : "alias",
    status: null,
    href: null,
    props: [{ key: "primary", value: d.is_primary ? "yes" : "no" }],
    remove: null,
  }))
}

const sendItems = async (query: any, websiteId: string): Promise<NodeItem[]> => {
  const website = await loadPages(query, websiteId)
  const logs = asArray<any>(website?.pages).flatMap((p) =>
    asArray<any>(p.subscription_send_logs).map((l) => ({ ...l, page: p }))
  )

  /*
   * 🔴 Failures FIRST. This node is only ever opened because it says some
   * sends failed, and a list ordered by insertion buries those under every
   * successful one — on a send to five hundred subscribers the reader would
   * scroll past four hundred and ninety successes to find the thing they came
   * for.
   */
  const failedIds = new Set(failedSends(logs).map((l) => l.id))
  const ordered = [
    ...logs.filter((l) => failedIds.has(String(l.id))),
    ...logs.filter((l) => !failedIds.has(String(l.id))),
  ]

  return ordered.map((l) => ({
    id: String(l.id),
    label: String(l.subscriber_email ?? l.subscriber_id ?? l.id),
    sublabel:
      [
        l.page?.title ? String(l.page.title) : null,
        l.provider ? String(l.provider) : null,
        // The reason, where there is one — it is why the row is at the top.
        l.error ? String(l.error).slice(0, 80) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    status: l.status ? String(l.status) : null,
    href: l.page?.id ? `/websites/${websiteId}/pages/${l.page.id}` : null,
    props: [
      { key: "status", value: String(l.status ?? "—") },
      ...(l.provider ? [{ key: "provider", value: String(l.provider) }] : []),
      ...(l.error ? [{ key: "error", value: String(l.error) }] : []),
    ],
    remove: null,
  }))
}

const RESOLVERS: Record<
  string,
  (query: any, websiteId: string) => Promise<NodeItem[]>
> = {
  pages: pageItems,
  published: publishedItems,
  newsletters: newsletterItems,
  empty_pages: emptyPageItems,
  blocks: blockItems,
  domains: domainItems,
  sends: sendItems,
}

export const WEBSITE_ITEM_NODES = Object.keys(RESOLVERS)

export const resolveWebsiteItems = async (
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
