import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import {
  deriveDesignSizes,
  normalizeColorPalette,
} from "../../../../lib/design-spec"

type Props = { design: PartnerDesign }

/**
 * Tags, sizes and the colour palette (#2019).
 *
 * 🔴 This was 71 lines rendered INLINE in `design-detail.tsx` — the one part
 * of the design manager the order context could not reuse, because it was not
 * a component. Every sibling block on that page (media, BOM, cost, sizes,
 * production, consumption, moodboard) is already a section; this was the hole,
 * and it is the block a partner deciding whether to accept a run most wants.
 *
 * The shape-unpicking moved to `lib/design-spec.ts`: `color_palette` has
 * carried at least four shapes over its life, and the same three-way fallback
 * appeared twice in one expression here.
 */
export const DesignSpecificationsSection = ({ design }: Props) => {
  const { t } = useTranslation()

  const tags = Array.isArray((design as any)?.tags)
    ? ((design as any).tags as unknown[]).map(String)
    : []
  const sizes = useMemo(
    () =>
      deriveDesignSizes(
        (design as any)?.size_sets,
        (design as any)?.custom_sizes
      ),
    [design]
  )
  const colors = useMemo(
    () => normalizeColorPalette((design as any)?.color_palette),
    [design]
  )

  if (!tags.length && !sizes.length && !colors.length) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">
          {t("partner.designs.detail.specifications")}
        </Heading>
      </div>

      {tags.length > 0 && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            {t("partner.designs.detail.tags")}
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag, i) => (
              <Badge key={i} size="2xsmall" color="grey">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {sizes.length > 0 && (
        <div className="px-6 py-4">
          <div className="mb-2 flex items-center gap-x-2">
            <Text size="xsmall" weight="plus" className="text-ui-fg-base">
              {t("partner.designs.sizes")}
            </Text>
            <Badge size="2xsmall" color="blue">
              {sizes.length}
            </Badge>
          </div>
          {/* Highlighted so the sizes that come with this design stand out. */}
          <div className="bg-ui-bg-highlight flex flex-col gap-y-2 rounded-lg p-3">
            {sizes.map(({ label, measurements }) => (
              <div key={label} className="flex items-start gap-x-3">
                <Badge size="2xsmall" color="blue" className="mt-0.5 shrink-0">
                  {label}
                </Badge>
                {measurements && typeof measurements === "object" ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {Object.entries(measurements as Record<string, any>).map(
                      ([key, val]) => (
                        <Text
                          key={key}
                          size="xsmall"
                          className="text-ui-fg-subtle"
                        >
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
        </div>
      )}

      {colors.length > 0 && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            {t("partner.designs.detail.colorPalette")}
          </Text>
          <div className="flex flex-wrap gap-2">
            {colors.map((color, i) => (
              <div key={i} className="flex items-center gap-x-1.5">
                <span
                  className="border-ui-border-base h-4 w-4 rounded-full border"
                  style={{ backgroundColor: color.value }}
                  role="img"
                  aria-label={color.name}
                />
                <Text size="xsmall">{color.name}</Text>
              </div>
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}
