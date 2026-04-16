import { getBaseURL } from "./env"

export type BreadcrumbItem = {
  name: string
  path: string // absolute path starting with "/", no origin
}

/**
 * Build schema.org/BreadcrumbList JSON-LD.
 *
 * Emits absolute URLs for `item` values — Google prefers fully qualified
 * URLs on BreadcrumbList items even when the page itself uses relative
 * canonicals.
 */
export const buildBreadcrumbJsonLd = (
  items: BreadcrumbItem[]
): Record<string, unknown> => {
  const baseUrl = getBaseURL()
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: `${baseUrl}${item.path}`,
    })),
  }
}
