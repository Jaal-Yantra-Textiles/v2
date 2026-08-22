import { Alert, Badge, Text } from "@medusajs/ui"

import type { QuoteReadiness } from "../../../hooks/api/quotes"

/**
 * What the mint would refuse, before the admin presses it (#1445).
 *
 * Every wrong number this feature produced was minted SUCCESSFULLY — a
 * zone-blind freight pick, a rupee rate in a euro total, a rule-bound zero that
 * shipped bulk free. Nobody had a signal. This is that signal.
 *
 * 🔑 Renders EVERY blocking reason at once. The server assessor deliberately
 * collects rather than throwing on the first, so that the whole basket is fixed
 * in one pass instead of one error per round trip; showing only the first would
 * throw that away at the last step.
 *
 * 🔴 On the admin surface the catalogue check is the one that matters most: an
 * admin picks a partner from one dropdown and variants from another, and
 * nothing downstream catches the mismatch.
 */
export const ReadinessPanel = ({
  readiness,
}: {
  readiness: QuoteReadiness
}) => {
  const blocking = readiness.issues.filter((i) => i.severity === "blocking")
  const warnings = readiness.issues.filter((i) => i.severity !== "blocking")

  if (readiness.ready && !warnings.length) {
    return (
      <Alert variant="success" className="mb-4">
        <div className="flex flex-col gap-y-1">
          <Text size="small" weight="plus">
            This quote is ready to mint.
          </Text>
          {readiness.freight.chosen && (
            <Text size="small" className="text-ui-fg-subtle">
              Freight: {readiness.freight.chosen.name ?? "—"} ·{" "}
              {readiness.freight.chosen.amount}{" "}
              {readiness.freight.chosen.currency_code.toUpperCase()}
              {readiness.freight.total_weight_grams
                ? ` · ${readiness.freight.total_weight_grams} g`
                : ""}
            </Text>
          )}
        </div>
      </Alert>
    )
  }

  return (
    <div className="mb-4 flex flex-col gap-y-3">
      {blocking.length > 0 && (
        <Alert variant="error">
          <div className="flex flex-col gap-y-2">
            <Text size="small" weight="plus">
              This quote cannot be minted yet
            </Text>
            <ul className="flex flex-col gap-y-1">
              {blocking.map((issue, i) => (
                <li key={`${issue.code}-${i}`} className="flex gap-x-2">
                  <Badge size="2xsmall" color="red">
                    {issue.code}
                  </Badge>
                  <Text size="small">{issue.message}</Text>
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert variant="warning">
          <div className="flex flex-col gap-y-2">
            <Text size="small" weight="plus">
              Worth knowing
            </Text>
            <ul className="flex flex-col gap-y-1">
              {warnings.map((issue, i) => (
                <li key={`${issue.code}-${i}`} className="flex gap-x-2">
                  <Badge size="2xsmall" color="orange">
                    {issue.code}
                  </Badge>
                  <Text size="small">{issue.message}</Text>
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}
    </div>
  )
}
