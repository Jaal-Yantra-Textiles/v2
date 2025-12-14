import { Button, Container, Heading } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"

type DesignActionsSectionProps = {
  design: PartnerDesign
  isPending?: boolean
}

export const DesignActionsSection = ({
  design,
  isPending = false,
}: DesignActionsSectionProps) => {
  const partnerStatus = design?.partner_info?.partner_status

  const canStart = partnerStatus === "assigned" || partnerStatus === "incoming"
  const canComplete =
    partnerStatus === "in_progress" || partnerStatus === "finished"

  const showStart = canStart && !design?.partner_info?.partner_started_at
  const showComplete = canComplete && !design?.partner_info?.partner_completed_at

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Actions</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {showStart && (
          <Button size="small" variant="secondary" disabled={isPending} asChild>
            <Link to="start">Start</Link>
          </Button>
        )}
        {showComplete && (
          <Button size="small" variant="primary" disabled={isPending} asChild>
            <Link to="complete">Complete</Link>
          </Button>
        )}
        <Button size="small" variant="secondary" disabled={isPending} asChild>
          <Link to="media">Manage Media</Link>
        </Button>
        <Button size="small" variant="secondary" disabled={isPending} asChild>
          <Link to="moodboard">Moodboard</Link>
        </Button>
      </div>
    </Container>
  )
}
