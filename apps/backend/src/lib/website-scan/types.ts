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
  /**
   * Facts we KNOW rather than infer — set by the records reader from our own
   * rows (a run's tasks, a line's material). They are merged into whatever a
   * model proposes, never replaced by it.
   */
  hints?: {
    actions?: string[]
    material?: string | null
    /** Media rows we already hold for this evidence — linked, not re-uploaded. */
    media_file_ids?: string[]
  }
}

export type ScannedCatalogue = {
  platform: "shopify" | "html" | "records"
  /** The site's origin; for a records scan, a label for where the rows came from. */
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
  /** Media rows we already hold (records scans) — attached as-is on commit. */
  media_file_ids?: string[]
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
  /**
   * "typesafe" when each item was classified by System One and grouped in code,
   * "model" when an LLM grouped it, "fallback" when grouping was mechanical.
   */
  grouped_by: "typesafe" | "model" | "fallback"
  product_count: number
  warnings: string[]
}
