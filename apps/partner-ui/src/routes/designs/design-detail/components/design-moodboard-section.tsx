import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import { summarizeMoodboardScene } from "../../../../lib/moodboard-scene"

type DesignMoodboardSectionProps = {
  design: PartnerDesign
}

/**
 * The moodboard's entry point on the design detail page (#2019).
 *
 * 🔴 This component USED TO DISCARD the design it was handed
 * (`{ design: _design }`) and render a heading, one line of static copy and a
 * link. From a design order that is four clicks and a full-page scroll to a
 * card that cannot tell you whether there is anything at the other end — so
 * the honest reading of a click was always "find out".
 *
 * It now says what is actually on the board, which is the difference between
 * an entry point and a signpost.
 */
export const DesignMoodboardSection = ({
  design,
}: DesignMoodboardSectionProps) => {
  const { t } = useTranslation()

  const summary = useMemo(
    () => summarizeMoodboardScene((design as any)?.moodboard),
    [design]
  )

  /**
   * 🔑 No "last edited" here on purpose. The only timestamp in reach is
   * `design.updated_at`, which moves on any design edit at all — a spec, a
   * status, a cost — so showing it as when the board was last worked on would
   * be a confident lie. It arrives honestly with the per-owner board row
   * (#2017), along with the thumbnail this card still cannot show.
   */
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-x-3">
          <Heading level="h2">{t("partner.designs.moodboard.heading")}</Heading>
          <Badge size="2xsmall" color={summary.hasContent ? "green" : "grey"}>
            {summary.hasContent
              ? t("partner.designs.moodboard.started")
              : t("partner.designs.moodboard.notStarted")}
          </Badge>
        </div>
        <Button size="small" variant="secondary" asChild>
          <Link to="moodboard">
            {summary.hasContent
              ? t("partner.designs.moodboard.open")
              : t("partner.designs.moodboard.start")}
          </Link>
        </Button>
      </div>
      <div className="px-6 py-4">
        {summary.hasContent ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex flex-col">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t("partner.designs.moodboard.frames")}
              </Text>
              <Text size="small" weight="plus">
                {summary.frameCount}
              </Text>
            </div>
            <div className="flex flex-col">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t("partner.designs.moodboard.otherElements")}
              </Text>
              <Text size="small" weight="plus">
                {summary.elementCount}
              </Text>
            </div>
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.designs.moodboard.emptyHint")}
          </Text>
        )}
      </div>
    </Container>
  )
}
