/**
 * When does the model genuinely EXPECT a neighbour on a website? (#1855)
 *
 * The content surface is the third spine, and the discipline is the one the
 * first two set: assert an absence ONLY where a real code path is left with
 * nowhere to go. A rule that fires on every empty relation trains the reader
 * to ignore the dashed edges, which costs more than drawing none.
 *
 * Pure functions with tests, because every mistake they can make is silent on
 * screen — a rule that never fires looks exactly like a healthy record.
 */

export type PageLike = {
  id: string
  status?: string | null
  page_type?: string | null
  content?: string | null
  sent_to_subscribers?: boolean | null
  sent_to_subscribers_at?: string | Date | null
  /** Count of blocks on the page, resolved by the caller. */
  block_count?: number
}

export const PUBLISHED = "Published"

/** A website that is meant to be serving traffic right now. */
export const LIVE_WEBSITE_STATUSES = new Set(["Active", "Maintenance"])

export const isLive = (status: string | null | undefined): boolean =>
  LIVE_WEBSITE_STATUSES.has(String(status))

export const publishedPages = (pages: PageLike[]): PageLike[] =>
  pages.filter((p) => String(p.status) === PUBLISHED)

/**
 * A live website serving nothing.
 *
 * 🔴 Conditional on the website being LIVE. A `Development` or `Inactive`
 * website with no published pages is a website being built, which is the
 * normal state of most of them for most of their life — dashing it there
 * would put a red edge on every new site from the moment it is created.
 */
export const expectsPublishedPage = (
  websiteStatus: string | null | undefined,
  pages: PageLike[]
): boolean => isLive(websiteStatus) && publishedPages(pages).length === 0

/**
 * A newsletter that was published and never sent.
 *
 * 🔴 THIS is the content spine's `approved_product_id`. The page is written,
 * marked Published, and appears in every list of published pages exactly like
 * one that went out — while `sent_to_subscribers` is false and not a single
 * subscriber ever received it. Nothing in the admin distinguishes the two, and
 * the work is already done; only the send is missing.
 *
 * A Draft newsletter is excluded: it is unfinished, and nobody expects an
 * unfinished newsletter to have been sent.
 */
export const newslettersAwaitingSend = (pages: PageLike[]): PageLike[] =>
  pages.filter(
    (p) =>
      String(p.page_type) === "Newsletter" &&
      String(p.status) === PUBLISHED &&
      !p.sent_to_subscribers
  )

/**
 * A published page that renders nothing.
 *
 * A page holds its body in EITHER `blocks` or the `content` text field, so
 * neither alone proves emptiness.
 *
 * 🔴 Both must be empty. Checking blocks alone would dash an edge on every
 * page written the other way — and the local database has published pages with
 * one block and published pages with seven, so both shapes are in real use.
 */
export const emptyPublishedPages = (pages: PageLike[]): PageLike[] =>
  publishedPages(pages).filter(
    (p) => (p.block_count ?? 0) === 0 && !String(p.content ?? "").trim()
  )

export type SendLogLike = { id: string; status?: string | null }

/**
 * Subscribers a send never reached.
 *
 * Not an absent NEIGHBOUR — a broken one, like the partner spine's unverified
 * WhatsApp number. The page says it was sent, the send log says some of it
 * failed, and the page's own `subscriber_count` counts the attempt rather than
 * the arrival.
 */
export const failedSends = (logs: SendLogLike[]): SendLogLike[] =>
  logs.filter((l) => String(l.status) === "failed")
