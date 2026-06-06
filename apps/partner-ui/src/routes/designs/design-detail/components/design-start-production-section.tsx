import { PlaySolid } from "@medusajs/icons"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"

type Props = { design: PartnerDesign }

/**
 * Roadmap #6 Phase 4 — owner-only "Start production" entry point for a
 * partner-created design. Opens the run-create modal (in-house /
 * outsourced). Admin-assigned designs don't show this — those runs are
 * created by the admin and dispatched to the partner.
 */
export const DesignStartProductionSection = ({ design }: Props) => {
  if (!(design as any).owner_partner_id) {
    return null
  }

  return (
    <Container className="flex items-center justify-between px-6 py-4">
      <div>
        <Heading level="h2">Production</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Run production yourself, or hand it to a sub-partner.
        </Text>
      </div>
      <Link to="production-run-create">
        <Button size="small" variant="secondary">
          <PlaySolid />
          Start production
        </Button>
      </Link>
    </Container>
  )
}
