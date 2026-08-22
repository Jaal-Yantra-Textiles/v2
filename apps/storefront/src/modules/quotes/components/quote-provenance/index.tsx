import { Heading, Text } from "@medusajs/ui"

import type { Provenance } from "@lib/data/quotes"

/**
 * Who made this, and how (#1439 S9).
 *
 * 🔑 Every judgement here belongs to the BACKEND's `buildProvenance`. It
 * decides which facts are public-safe — commercial terms, the partner's price
 * band and their tax identifiers are all deliberately excluded there — and it
 * OMITS a row whose fact is absent rather than em-dashing it. So this component
 * renders `rows` as given: it must never add a fallback value, a placeholder or
 * a "not specified", because an em-dash reads as "we know this and it is
 * nothing", which is a different and wrong claim about a supplier.
 *
 * `provenance: null` means say nothing at all — the section, heading included,
 * simply does not exist. A sparse partner therefore shows fewer rows; it never
 * shows a grid of blanks.
 *
 * The story is prose and gets a paragraph; the rest are labelled facts and get
 * a list. `source` is not rendered — it exists so a future surface can caption
 * where a fact came from without parsing labels.
 */
const QuoteProvenanceSection = ({ provenance }: { provenance: Provenance }) => {
  const { maker_name, maker_story, rows } = provenance
  if (!rows.length && !maker_story) return null

  return (
    <div className="mt-10">
      <Heading level="h2" className="text-xl-semi text-ui-fg-base mb-2">
        {maker_name ? `About ${maker_name}` : "About this maker"}
      </Heading>

      {maker_story ? (
        <Text className="txt-medium text-ui-fg-subtle whitespace-pre-line">
          {maker_story}
        </Text>
      ) : null}

      {rows.length ? (
        <dl
          className={`grid grid-cols-1 gap-x-8 gap-y-3 small:grid-cols-2 ${
            maker_story ? "mt-6" : "mt-4"
          }`}
        >
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-col border-t border-ui-border-base pt-3"
            >
              <dt className="txt-small text-ui-fg-muted uppercase tracking-wide">
                {row.label}
              </dt>
              <dd className="txt-medium text-ui-fg-base">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

export default QuoteProvenanceSection
