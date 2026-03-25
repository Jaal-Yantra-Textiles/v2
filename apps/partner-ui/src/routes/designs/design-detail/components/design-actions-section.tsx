import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { Link } from "react-router-dom"

import {
  PartnerDesign,
  useStartPartnerDesign,
  useFinishPartnerDesign,
  useRedoPartnerDesign,
  useRefinishPartnerDesign,
} from "../../../../hooks/api/partner-designs"
import { extractErrorMessage } from "../../../../lib/extract-error-message"

type DesignActionsSectionProps = {
  design: PartnerDesign
  isPending?: boolean
}

export const DesignActionsSection = ({
  design,
  isPending = false,
}: DesignActionsSectionProps) => {
  const designId = design?.id || ""
  const partnerStatus = design?.partner_info?.partner_status
  const partnerPhase = design?.partner_info?.partner_phase

  const startDesign = useStartPartnerDesign(designId)
  const finishDesign = useFinishPartnerDesign(designId)
  const redoDesign = useRedoPartnerDesign(designId)
  const refinishDesign = useRefinishPartnerDesign(designId)

  // Flow: incoming/assigned → Start → in_progress → Finish → finished → Complete
  // Redo: finished → Redo → in_progress (with phase="redo")
  // Refinish: redo phase + in_progress → Refinish → finished

  const isCancelled = partnerStatus === "cancelled"

  const canStart =
    !isCancelled &&
    (partnerStatus === "assigned" || partnerStatus === "incoming") &&
    !design?.partner_info?.partner_started_at
  const canFinish = !isCancelled && partnerStatus === "in_progress" && partnerPhase !== "redo"
  const canRefinish = !isCancelled && partnerStatus === "in_progress" && partnerPhase === "redo"
  const canRedo = !isCancelled && partnerStatus === "finished"
  const canComplete =
    !isCancelled &&
    partnerStatus === "finished" &&
    !design?.partner_info?.partner_completed_at

  const isAnyLoading =
    isPending ||
    startDesign.isPending ||
    finishDesign.isPending ||
    redoDesign.isPending ||
    refinishDesign.isPending

  const handleStart = async () => {
    try {
      await startDesign.mutateAsync()
      toast.success("Design started")
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleFinish = async () => {
    try {
      await finishDesign.mutateAsync()
      toast.success("Design marked as finished")
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleRedo = async () => {
    try {
      await redoDesign.mutateAsync()
      toast.success("Design sent back for rework")
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleRefinish = async () => {
    try {
      await refinishDesign.mutateAsync()
      toast.success("Design refinished")
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Actions</Heading>
        {partnerStatus && (
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Current status: {partnerStatus}
            {partnerPhase ? ` (${partnerPhase})` : ""}
          </Text>
        )}
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {isCancelled && (
          <Text size="small" className="text-ui-fg-error">
            This design assignment has been cancelled by the admin.
          </Text>
        )}
        {canStart && (
          <Button
            size="small"
            variant="secondary"
            disabled={isAnyLoading}
            isLoading={startDesign.isPending}
            onClick={handleStart}
          >
            Start Working
          </Button>
        )}
        {canFinish && (
          <Button
            size="small"
            variant="primary"
            disabled={isAnyLoading}
            isLoading={finishDesign.isPending}
            onClick={handleFinish}
          >
            Mark as Finished
          </Button>
        )}
        {canRefinish && (
          <Button
            size="small"
            variant="primary"
            disabled={isAnyLoading}
            isLoading={refinishDesign.isPending}
            onClick={handleRefinish}
          >
            Refinish (Complete Rework)
          </Button>
        )}
        {canRedo && (
          <Button
            size="small"
            variant="secondary"
            disabled={isAnyLoading}
            isLoading={redoDesign.isPending}
            onClick={handleRedo}
          >
            Redo (Needs Rework)
          </Button>
        )}
        {canComplete && (
          <Button size="small" variant="primary" disabled={isAnyLoading} asChild>
            <Link to="complete">Complete & Record Inventory</Link>
          </Button>
        )}

        <div className="border-t border-ui-border-base my-1" />

        <Button size="small" variant="secondary" disabled={isAnyLoading} asChild>
          <Link to="media">Manage Media</Link>
        </Button>
        <Button size="small" variant="secondary" disabled={isAnyLoading} asChild>
          <Link to="moodboard">Moodboard</Link>
        </Button>
      </div>
    </Container>
  )
}
