import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"

type DesignMediaSectionProps = {
  design: PartnerDesign
  /**
   * Where the "Manage" / preview links point, relative to the CURRENT route.
   *
   * On the design manager (`/designs/:id`, and its in-order twin
   * `/orders/:id/design-details/:designId`) the upload + preview routes are
   * direct children, so the default empty base resolves to `media` /
   * `media-preview` and is correct.
   *
   * The order detail (`/orders/:id`) renders this section for a design it shows
   * INLINE — there is no `media` child of the order itself, so it passes
   * `design-details/<designId>` and the links land on the design's own routes.
   */
  linkBase?: string
}

export const DesignMediaSection = ({
  design,
  linkBase,
}: DesignMediaSectionProps) => {
  const { t } = useTranslation()
  const mediaFiles = (design as any)?.media_files as
    | Array<{ id?: string; url: string; isThumbnail?: boolean }>
    | undefined

  const base = linkBase ? `${linkBase.replace(/\/$/, "")}/` : ""

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Heading level="h2">{t("partner.designs.media.heading")}</Heading>
        <Button size="small" variant="secondary" asChild>
          <Link to={`${base}media`}>{t("partner.designs.media.manage")}</Link>
        </Button>
      </div>
      {mediaFiles?.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4 px-6 py-4">
          {mediaFiles.slice(0, 8).map((media, index) => {
            return (
              <Link
                key={media.id || String(index)}
                to={`${base}media-preview`}
                state={{ curr: index }}
                className="shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-fg group relative aspect-square size-full cursor-pointer overflow-hidden rounded-[8px]"
              >
                <img
                  src={media.url}
                  alt={t("partner.designs.media.alt")}
                  className="size-full object-cover"
                />
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-y-4 pb-8 pt-6">
          <div className="flex flex-col items-center">
            <Text
              size="small"
              leading="compact"
              weight="plus"
              className="text-ui-fg-subtle"
            >
              {t("partner.designs.media.empty")}
            </Text>
            <Text size="small" className="text-ui-fg-muted">
              {t("partner.designs.media.emptyHint")}
            </Text>
          </div>
          <Button size="small" variant="secondary" asChild>
            <Link to={`${base}media`}>{t("partner.designs.media.addMedia")}</Link>
          </Button>
        </div>
      )}
    </Container>
  )
}