import { Text } from "@medusajs/ui"

import type { QuoteLineSpec } from "@lib/data/quotes"
import SpecIcon from "@modules/products/components/production-spec/spec-icon"

/**
 * "What this is made to", under a quoted line (#1428).
 *
 * The founder's ask was "we need more details" — a buyer weighing a
 * seven-figure consignment was looking at a spreadsheet. On a handloom product
 * the construction IS the product, so it belongs beside the price rather than
 * a click away on a page the buyer may never open.
 *
 * 🔑 Facts only, and the backend already enforces that: no palette, no option
 * groups, no "accepting custom orders". A quote is frozen against specific
 * variants, so offering a choice here would be a promise nothing behind this
 * page can keep.
 *
 * The glyph name comes from the backend's registry, where the param is
 * defined. `SpecIcon` falls back to a neutral mark, so a spec written against a
 * newer registry than this storefront has deployed renders a plain row rather
 * than a blank space.
 */
const QuoteLineSpecRows = ({ spec }: { spec: QuoteLineSpec }) => (
  <div className="mt-3 flex flex-col gap-y-1">
    {spec.weave_label ? (
      <Text className="txt-small-plus text-ui-fg-subtle">{spec.weave_label}</Text>
    ) : null}

    {spec.rows.length ? (
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {spec.rows.map((row) => (
          <li
            key={row.key || row.label}
            className="flex items-center gap-x-1.5 text-ui-fg-muted"
          >
            <SpecIcon name={row.icon} className="shrink-0" />
            <Text className="txt-small">
              {row.label}
              {" · "}
              <span className="text-ui-fg-subtle">
                {row.value}
                {row.unit ? ` ${row.unit}` : ""}
              </span>
            </Text>
          </li>
        ))}
      </ul>
    ) : null}

    {spec.finishes.length ? (
      <Text className="txt-small text-ui-fg-muted">
        Finish: {spec.finishes.join(", ")}
      </Text>
    ) : null}
  </div>
)

export default QuoteLineSpecRows
