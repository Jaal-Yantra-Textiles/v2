import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"

type DesignMoodboardSectionProps = {
  design: PartnerDesign
}

export const DesignMoodboardSection = ({ design: _design }: DesignMoodboardSectionProps) => {
  const { t } = useTranslation()
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Heading level="h2">{t("partner.designs.moodboard.heading")}</Heading>
      </div>
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t("partner.designs.moodboard.description")}
        </Text>
        <div className="mt-4">
          <Button size="small" variant="secondary" asChild>
            <Link to="moodboard">{t("partner.designs.moodboard.open")}</Link>
          </Button>
        </div>
      </div>
    </Container>
  )
}