/**
 * newsletter-prefill-lib — #659. Pure mapping from a `marketing_draft`
 * (kind="newsletter") payload — produced by the #687 generate-newsletter-draft
 * job — into the fields the blog editor's create-page form needs to pre-fill a
 * `page_type="Newsletter"` page: a `title` (the subject line) and a `content`
 * body (the intro + each section as a "## heading / body" block).
 *
 * Pure + unit-tested so the endpoint and the integration test share ONE mapping.
 */

export type NewsletterSection = {
  heading?: string | null
  body?: string | null
}

export type NewsletterDraftPayload = {
  subject?: string | null
  preheader?: string | null
  intro?: string | null
  sections?: NewsletterSection[] | null
}

export type NewsletterPrefill = {
  title: string
  content: string
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * Build the editor prefill from a newsletter draft payload. The content is
 * Markdown-ish (intro paragraph, then `## heading` + body per section) so it
 * drops cleanly into the editor for the operator to refine. Never throws — a
 * missing/garbage payload yields empty strings (the form just isn't pre-filled).
 */
export function buildNewsletterPrefill(
  payload: NewsletterDraftPayload | null | undefined
): NewsletterPrefill {
  const title = clean(payload?.subject)
  const parts: string[] = []

  const intro = clean(payload?.intro)
  if (intro) parts.push(intro)

  const sections = Array.isArray(payload?.sections) ? payload!.sections! : []
  for (const s of sections) {
    const heading = clean(s?.heading)
    const body = clean(s?.body)
    if (heading) parts.push(`## ${heading}`)
    if (body) parts.push(body)
  }

  return { title, content: parts.join("\n\n") }
}
