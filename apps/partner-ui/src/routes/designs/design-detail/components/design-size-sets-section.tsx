import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { deriveDesignSizes } from "../../../../lib/design-spec"

/**
 * #3 — read-only sizes panel for a design, shared by the standalone design page
 * and the order → production-run design manager (single + collated).
 *
 * Sizes reach a design in one of two shapes:
 *   - `size_sets`  — the normalized relation `[{ size_label, measurements }]`
 *                    (the current format; produced by `convertCustomSizesToSizeSets`).
 *   - `custom_sizes` — a legacy JSON map `{ "S": { chest, length }, ... }`.
 *
 * Most existing designs still carry their sizes on `custom_sizes`, so we prefer
 * `size_sets` but fall back to `custom_sizes` — otherwise the partner sees no
 * sizes at all on the order. Mirrors the admin `design-sizes-section`.
 */
export const DesignSizeSetsSection = ({ design }: { design: any }) => {
  const { t } = useTranslation()

  /**
   * #2019 — one derivation, not three. This exact block also lived inline in
   * `design-detail.tsx` and again in the new specifications section; a rule
   * with three copies is a rule that will disagree with itself. The prefer-
   * `size_sets`-then-fall-back-to-`custom_sizes` logic, and the reason the two
   * must never be merged, now live in `lib/design-spec.ts` with tests.
   */
  const sizes = useMemo(
    () => deriveDesignSizes(design?.size_sets, design?.custom_sizes),
    [design]
  )

  if (sizes.length === 0) {
    return null
  }

  return (
    <Container className="p-0">
      <div className="flex items-center gap-x-2 px-6 py-4">
        <Heading level="h2">{t("partner.designs.sizes")}</Heading>
        <Badge size="2xsmall" color="blue">
          {sizes.length}
        </Badge>
      </div>
      <div className="flex flex-col gap-y-2 px-6 pb-6">
        {sizes.map(({ label, measurements }) => (
          <div
            key={label}
            className="flex items-start gap-x-3 rounded-lg bg-ui-bg-subtle p-3"
          >
            <Badge size="2xsmall" color="blue" className="mt-0.5 shrink-0">
              {label}
            </Badge>
            {measurements && typeof measurements === "object" ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(measurements as Record<string, any>).map(
                  ([key, val]) => (
                    <Text key={key} size="xsmall" className="text-ui-fg-subtle">
                      {key}: {val != null ? String(val) : "-"}
                    </Text>
                  )
                )}
              </div>
            ) : measurements != null ? (
              <Text size="xsmall" className="text-ui-fg-subtle">
                {String(measurements)}
              </Text>
            ) : null}
          </div>
        ))}
      </div>
    </Container>
  )
}
