/** One product as read off a partner's site, before any model touches it. */
export type ScannedProduct = {
  title: string
  product_type: string | null
  tags: string[]
  /** Plain text, trimmed — never HTML. */
  description: string
  /** Absolute image URLs, first = primary. */
  images: string[]
  /** The product's own page. */
  url: string | null
  /** When the site says it was published — our best proxy for captured_at. */
  published_at: string | null
}

export type ScannedCatalogue = {
  platform: "shopify" | "html"
  origin: string
  products: ScannedProduct[]
  /** Visible "about us" style text, for knowledge and technique cues. */
  page_text: string
  warnings: string[]
}

export type ProposedSample = {
  /** Stable within a scan; what commit selects by. */
  key: string
  title: string
  product_type: string | null
  technique: string | null
  material: string | null
  actions: string[]
  notes: string | null
  image_urls: string[]
  source_url: string | null
  /** ISO. Null when the site gave no date — commit then uses the scan date. */
  captured_at: string | null
  /** The product titles this rests on, so an operator can check it. */
  evidence: string[]
}

export type ProposedKnowledge = {
  key: string
  fact: string
  /** Key of the sample it is about, or null for a partner-wide fact. */
  sample_key: string | null
  source_url: string | null
}

export type ScanProposal = {
  summary: string | null
  product_types: string[]
  samples: ProposedSample[]
  knowledge: ProposedKnowledge[]
  /** "model" when an LLM grouped it, "fallback" when grouping was mechanical. */
  grouped_by: "model" | "fallback"
  product_count: number
  warnings: string[]
}
