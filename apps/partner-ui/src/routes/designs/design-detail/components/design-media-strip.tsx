import { Button, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"

type Props = {
  design: PartnerDesign
  /**
   * Where the media links point, relative to the CURRENT route — same contract
   * as DesignMediaSection, which still owns the full grid on the order surfaces.
   */
  linkBase?: string
}

/** How many thumbs before "+N" — one row on a phone, comfortably short elsewhere. */
const MAX_THUMBS = 6

/**
 * The design's reference images, compressed to a single row for the page header.
 *
 * The standalone Media section was a whole card that only ever showed
 * thumbnails and a Manage button, sitting in the sidebar under the fold. On a
 * page that already carries General, Specifications, BOM, Cost, Production and
 * Consumption cards, a card that shows pictures and does nothing else is the
 * cheapest thing to fold into the header — so it moved here, next to the
 * design's name (#2019 family).
 *
 * DesignMediaSection is NOT deleted: the order detail and the collated
 * design-details view still render the full grid, where there is no header card
 * to fold into.
 *
 * Wraps and stays inside the gutter on a phone — the thumbs flow, they do not
 * scroll sideways.
 */
export const DesignMediaStrip = ({ design, linkBase }: Props) => {
  const { t } = useTranslation()
  const mediaFiles = (design as any)?.media_files as
    | Array<{ id?: string; url: string; isThumbnail?: boolean }>
    | undefined

  const base = linkBase ? `${linkBase.replace(/\/$/, "")}/` : ""
  const shown = mediaFiles?.slice(0, MAX_THUMBS) ?? []
  const overflow = (mediaFiles?.length ?? 0) - shown.length

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.length ? (
        <>
          {shown.map((media, index) => (
            <Link
              key={media.id || String(index)}
              to={`${base}media-preview`}
              state={{ curr: index }}
              className="shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-fg size-12 shrink-0 overflow-hidden rounded-md"
            >
              <img
                src={media.url}
                alt={t("partner.designs.media.alt")}
                className="size-full object-cover"
              />
            </Link>
          ))}
          {overflow > 0 ? (
            <Link
              to={`${base}media`}
              className="bg-ui-bg-subtle text-ui-fg-subtle flex size-12 shrink-0 items-center justify-center rounded-md"
            >
              <Text size="small">+{overflow}</Text>
            </Link>
          ) : null}
        </>
      ) : (
        <Text size="small" className="text-ui-fg-muted">
          {t("partner.designs.media.empty")}
        </Text>
      )}

      <Button size="small" variant="transparent" asChild className="ml-auto">
        <Link to={`${base}media`}>
          {shown.length
            ? t("partner.designs.media.manage")
            : t("partner.designs.media.addMedia")}
        </Link>
      </Button>
    </div>
  )
}
