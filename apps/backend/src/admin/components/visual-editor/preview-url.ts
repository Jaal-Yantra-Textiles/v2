/**
 * Pure helpers for building the storefront preview URL/path for a website page.
 *
 * The path must mirror how the storefront actually serves a page by its
 * `page_type` (see create-blog.tsx slug convention):
 *  - Home pages live at the root "/".
 *  - A slug that already starts with "/" is a custom absolute path → used verbatim.
 *  - Blog/Newsletter pages are served under "/blog/<slug>".
 *  - Everything else (About/Contact/Product/Service/Portfolio/Landing/Custom)
 *    is root-level: "/<slug>".
 */
export type PreviewPageType =
  | "Home"
  | "About"
  | "Contact"
  | "Blog"
  | "Product"
  | "Service"
  | "Portfolio"
  | "Landing"
  | "Custom"
  | "Newsletter"
  | string

/**
 * Resolve the storefront path (leading "/") for a page given its slug + page_type.
 * Pure — no environment access.
 */
export function buildPreviewPath(slug: string, pageType?: PreviewPageType): string {
  // Home: explicit "home" slug or Home page type.
  if (slug === "home" || pageType === "Home") {
    return "/"
  }
  // Custom absolute path: slug already includes its own leading "/".
  if (slug.startsWith("/")) {
    return slug
  }
  // Blog + Newsletter are served under /blog/<slug>.
  if (pageType === "Blog" || pageType === "Newsletter") {
    return `/blog/${slug}`
  }
  // Everything else is root-level today.
  return `/${slug}`
}
