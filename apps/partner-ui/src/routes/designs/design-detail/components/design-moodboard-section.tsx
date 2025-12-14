import { Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"

type DesignMoodboardSectionProps = {
  design: PartnerDesign
}

export const DesignMoodboardSection = ({ design: _design }: DesignMoodboardSectionProps) => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Moodboard</Heading>
      </div>
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Collect references and inspiration.
        </Text>
        <div className="mt-4">
          <Button size="small" variant="secondary" asChild>
            <Link to="moodboard">Open Moodboard</Link>
          </Button>
        </div>
      </div>
    </Container>
  )
}
