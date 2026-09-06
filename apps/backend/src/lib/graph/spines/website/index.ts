import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { GraphBuilder, asArray } from "../../builder"
import type { Graph, GraphNode, SpineContext, SpineDescriptor } from "../../types"
import {
  emptyPublishedPages,
  expectsPublishedPage,
  failedSends,
  isLive,
  newslettersAwaitingSend,
  publishedPages,
  type PageLike,
} from "./absence"
import { WEBSITE_ITEM_NODES, resolveWebsiteItems } from "./items"

/**
 * The WEBSITE spine (#1855) — the content surface.
 *
 * The third spine, and the first that is not about production. It is here
 * because content has the same shape of failure the design spine was built
 * for: a newsletter written, marked Published, and never sent sits in every
 * list of published pages looking exactly like one that went out. The work is
 * finished and the send is missing, and no count anywhere says so.
 *
 * 🔴 Pages, blocks and domains are intra-module relations on the website and
 * page models, NOT module links — so they resolve straight off the entity and
 * the `entryPoint` treatment the other spines need does not apply here. The
 * link-derived nodes are the ones that need `resolveExisting`; this spine has
 * none, which is why it does not use it.
 */
const resolveWebsiteGraph = async ({ scope, id }: SpineContext): Promise<Graph> => {
  const websiteId = id
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: websites } = await query.graph({
    entity: "websites",
    filters: { id: websiteId },
    fields: [
      "*",
      "pages.*",
      "pages.blocks.*",
      "pages.subscription_send_logs.*",
      "domains.*",
    ],
  })

  const website = (websites || [])[0]
  if (!website) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Website ${websiteId} was not found`
    )
  }

  const rawPages = asArray<any>(website.pages)
  const domains = asArray<any>(website.domains)

  /*
   * Blocks and send logs come back nested under each page. Flattened here so
   * the absence rules take a plain shape — and `block_count` is resolved onto
   * the page, because "is this page empty?" is a question about the page.
   */
  const pages: PageLike[] = rawPages.map((p) => ({
    id: String(p.id),
    status: p.status,
    page_type: p.page_type,
    content: p.content,
    sent_to_subscribers: p.sent_to_subscribers,
    sent_to_subscribers_at: p.sent_to_subscribers_at,
    block_count: asArray<any>(p.blocks).length,
  }))

  const sendLogs = rawPages.flatMap((p) =>
    asArray<any>(p.subscription_send_logs).map((l) => ({
      id: String(l.id),
      status: l.status,
    }))
  )

  const live = publishedPages(pages)
  const unsentNewsletters = newslettersAwaitingSend(pages)
  const emptyPages = emptyPublishedPages(pages)
  const failed = failedSends(sendLogs)
  const totalBlocks = pages.reduce((n, p) => n + (p.block_count ?? 0), 0)

  const builder = new GraphBuilder("website")
  const push = builder.push.bind(builder)

  // ---- pages --------------------------------------------------------------

  if (pages.length) {
    push(
      {
        key: "pages",
        type: "page",
        label: "Pages",
        sublabel: `${live.length} of ${pages.length} published`,
        state: "present",
        count: pages.length,
        status: null,
        href: `/websites/${websiteId}/pages`,
        props: [
          { key: "published", value: String(live.length) },
          { key: "draft", value: String(pages.length - live.length) },
        ],
        action: null,
      },
      { label: "website_id", state: "present", reason: null }
    )
  } else if (expectsPublishedPage(website.status, pages)) {
    push(
      {
        key: "pages",
        type: "page",
        label: "Pages",
        sublabel: "nothing to serve",
        state: "absent",
        count: 0,
        status: null,
        href: `/websites/${websiteId}/pages`,
        props: [{ key: "website status", value: String(website.status) }],
        action: { label: "Add a page", href: `/websites/${websiteId}/pages` },
      },
      {
        label: "website_id",
        state: "absent",
        reason: `This website is ${website.status} and has no page at all, so every request to it resolves to nothing.`,
      }
    )
  }

  /*
   * 🔴 A SEPARATE node from `pages`, deliberately.
   *
   * A live website with fifty drafts and nothing published has a perfectly
   * healthy-looking `pages` node — fifty of them, present. Folding this into
   * that node's state would hide it behind a count, which is precisely the
   * failure mode this whole view exists to remove.
   */
  if (pages.length && expectsPublishedPage(website.status, pages)) {
    push(
      {
        key: "published",
        type: "page",
        label: "Published pages",
        sublabel: "none live",
        state: "absent",
        count: 0,
        status: null,
        href: `/websites/${websiteId}/pages`,
        props: [
          { key: "website status", value: String(website.status) },
          { key: "drafts", value: String(pages.length) },
        ],
        action: { label: "Publish a page", href: `/websites/${websiteId}/pages` },
      },
      {
        label: "status = Published",
        state: "absent",
        reason: `This website is ${website.status} but not one of its ${pages.length} page${pages.length === 1 ? "" : "s"} is published, so visitors are served nothing.`,
      }
    )
  }

  // ---- newsletters: the motivating absent edge -----------------------------

  if (unsentNewsletters.length) {
    push(
      {
        key: "newsletters",
        type: "page",
        label: "Newsletters",
        sublabel: `${unsentNewsletters.length} never sent`,
        state: "absent",
        count: unsentNewsletters.length,
        status: null,
        href: `/websites/${websiteId}/pages`,
        props: [
          { key: "published, unsent", value: String(unsentNewsletters.length) },
          {
            key: "first",
            value: String(unsentNewsletters[0]?.id ?? "").slice(0, 18),
          },
        ],
        action: { label: "Send to subscribers", href: `/websites/${websiteId}/pages` },
      },
      {
        label: "sent_to_subscribers",
        state: "absent",
        reason: `${unsentNewsletters.length} newsletter${unsentNewsletters.length === 1 ? " is" : "s are"} published and ${unsentNewsletters.length === 1 ? "was" : "were"} never sent. ${unsentNewsletters.length === 1 ? "It appears" : "They appear"} in every list of published pages exactly like one that went out, and no subscriber received it.`,
      }
    )
  }

  // ---- empty published pages ----------------------------------------------

  if (emptyPages.length) {
    push(
      {
        key: "empty_pages",
        type: "page",
        label: "Empty pages",
        sublabel: `${emptyPages.length} render nothing`,
        state: "absent",
        count: emptyPages.length,
        status: null,
        href: `/websites/${websiteId}/pages`,
        props: [{ key: "published, empty", value: String(emptyPages.length) }],
        action: { label: "Add content", href: `/websites/${websiteId}/pages` },
      },
      {
        label: "blocks / content",
        state: "absent",
        reason: `${emptyPages.length} published page${emptyPages.length === 1 ? " has" : "s have"} neither blocks nor body text, so ${emptyPages.length === 1 ? "it serves" : "they serve"} an empty document to anyone who reaches ${emptyPages.length === 1 ? "it" : "them"}.`,
      }
    )
  }

  // ---- blocks -------------------------------------------------------------

  if (totalBlocks) {
    push(
      {
        key: "blocks",
        type: "block",
        label: "Blocks",
        sublabel: `${totalBlocks} across ${pages.length} page${pages.length === 1 ? "" : "s"}`,
        state: "present",
        count: totalBlocks,
        status: null,
        href: `/websites/${websiteId}/pages`,
        props: [{ key: "blocks", value: String(totalBlocks) }],
        action: null,
      },
      { label: "page_id", state: "present", reason: null }
    )
  }

  // ---- domains ------------------------------------------------------------

  if (domains.length) {
    const primary = domains.filter((d) => d.is_primary)
    push(
      {
        key: "domains",
        type: "website_domain",
        label: "Domains",
        sublabel: `${domains.length} alias${domains.length === 1 ? "" : "es"}`,
        state: "present",
        count: domains.length,
        status: null,
        href: `/websites/${websiteId}`,
        props: [
          { key: "aliases", value: String(domains.length) },
          { key: "primary", value: String(primary.length) },
        ],
        action: null,
      },
      { label: "website_id", state: "present", reason: null }
    )
  }

  // ---- sends --------------------------------------------------------------

  if (sendLogs.length) {
    push(
      {
        key: "sends",
        type: "subscription_send_log",
        label: "Subscriber sends",
        sublabel: failed.length
          ? `${failed.length} of ${sendLogs.length} failed`
          : `${sendLogs.length} delivered`,
        /*
         * 🔴 `derived` when sends failed, not `absent`. The neighbour is not
         * missing — it is there and part of it did not work. The page records
         * that it was sent and counts the ATTEMPT; the failures are only in the
         * log, which nothing on the page reads.
         */
        state: failed.length ? "derived" : "present",
        count: sendLogs.length,
        status: failed.length ? "partial" : null,
        href: `/websites/${websiteId}/pages`,
        props: [
          { key: "sent", value: String(sendLogs.length - failed.length) },
          { key: "failed", value: String(failed.length) },
        ],
        action: null,
      },
      {
        label: "subscription_send_log",
        state: failed.length ? "derived" : "present",
        reason: failed.length
          ? `${failed.length} send${failed.length === 1 ? "" : "s"} failed. The page still reports that it was sent, and its subscriber count counts the attempt rather than the arrival.`
          : null,
      }
    )
  }

  const spine: GraphNode = {
    key: "website",
    type: "website",
    label: String(website.name ?? websiteId),
    sublabel: String(website.domain ?? ""),
    state: "present",
    count: 1,
    status: String(website.status ?? ""),
    href: `/websites/${websiteId}`,
    props: [
      { key: "status", value: String(website.status ?? "—") },
      { key: "live", value: isLive(website.status) ? "yes" : "no" },
      { key: "domain", value: String(website.domain ?? "—") },
      { key: "language", value: String(website.primary_language ?? "—") },
      ...(website.analytics_provider
        ? [{ key: "analytics", value: String(website.analytics_provider) }]
        : []),
    ],
    action: null,
  }

  return builder.build(spine)
}

export const websiteSpine: SpineDescriptor = {
  key: "website",
  label: "Website",
  resolve: resolveWebsiteGraph,
  items: resolveWebsiteItems,
  itemNodes: WEBSITE_ITEM_NODES,
}
