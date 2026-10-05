import { convertContentToHtml } from "./build-email-data"

/**
 * #2349 — the React Email editor's `getEmailHTML()` returns a whole document
 * (`<!DOCTYPE><html><head>…</head><body>…</body></html>`). The DB template
 * (`blog-subscriber`) is itself a whole document and injects the post through
 * `{{{blog_content}}}`, so only the inside of `<body>` may go there — a nested
 * `<html>`/`<body>` is invalid and clients render it unpredictably.
 *
 * Input with no `<body>` (a fragment) is returned unchanged.
 */
export function extractEmailBodyHtml(html: string): string {
  if (!html) return ""
  const match = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)
  return (match ? match[1] : html).trim()
}

/**
 * The HTML that goes into `{{{blog_content}}}` for a blog send.
 *
 * A page with an email version built in the Email tab (`email_html` on its main
 * block) sends exactly that; every other page keeps the TipTap → HTML converter,
 * so posts written before #2349 send as they always did.
 */
export function resolveBlogEmailHtml(blogData: {
  content?: any
  email_html?: string | null
}): string {
  const designed =
    typeof blogData?.email_html === "string" ? extractEmailBodyHtml(blogData.email_html) : ""
  if (designed) return designed
  return convertContentToHtml(blogData?.content)
}
