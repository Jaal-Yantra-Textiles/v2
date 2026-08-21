import { Alert, Badge, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import type { QuoteReadiness } from "../../../../../hooks/api/partner-quotes"

/**
 * What the mint would refuse, before the partner presses it (#1445).
 *
 * Every wrong number this feature produced was minted SUCCESSFULLY — a
 * zone-blind freight pick, a rupee rate in a euro total, a rule-bound zero
 * that shipped bulk free. The partner had no signal at all. This is that
 * signal.
 *
 * 🔑 Renders EVERY blocking reason at once. The server assessor deliberately
 * collects rather than throwing on the first, so that a partner fixes the
 * whole basket in one pass instead of one error per round trip; showing only
 * the first would throw that away at the last step.
 *
 * Warnings are shown but never block — a missing tax region means tax cannot
 * be displayed yet (#1447), which is a gap in what we have shipped, not a
 * reason to refuse a partner their quote.
 */
export const QuoteReadinessPanel = ({
  readiness,
}: {
  readiness: QuoteReadiness
}) => {
  const { t } = useTranslation()

  const blocking = readiness.issues.filter((i) => i.severity === "blocking")
  const warnings = readiness.issues.filter((i) => i.severity !== "blocking")

  if (readiness.ready && !warnings.length) {
    return (
      <Alert variant="success" className="mb-4">
        <div className="flex flex-col gap-y-1">
          <Text size="small" weight="plus">
            {t("quotes.create.readiness.ok", "This quote is ready to mint.")}
          </Text>
          {readiness.freight.chosen && (
            <Text size="small" className="text-ui-fg-subtle">
              {t("quotes.create.readiness.freight", "Freight")}:{" "}
              {readiness.freight.chosen.name ?? "—"} ·{" "}
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
              {t(
                "quotes.create.readiness.blocked",
                "This quote cannot be minted yet"
              )}
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
              {t("quotes.create.readiness.warnings", "Worth knowing")}
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
