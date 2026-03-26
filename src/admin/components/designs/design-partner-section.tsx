import { Container, Heading, Text, Avatar, Button, Badge, toast } from "@medusajs/ui";
import { Plus, Trash, XCircle, TriangleRightMini } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import {
  AdminDesign,
  useSendDesignToPartner,
  useUnlinkDesignFromPartner,
  useCancelPartnerAssignment,
} from "../../hooks/api/designs";
import { AdminPartner } from "../../hooks/api/partners";
import { useProductionRuns } from "../../hooks/api/production-runs";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";

interface DesignPartnerSectionProps {
  design: AdminDesign & { partners?: AdminPartner[] };
}

export const DesignPartnerSection = ({ design }: DesignPartnerSectionProps) => {
  const navigate = useNavigate();
  const partners = design.partners || [];
  const { mutateAsync: sendDesign, isPending: isSending } = useSendDesignToPartner(design.id)
  const { mutateAsync: unlinkPartner, isPending: isUnlinking } = useUnlinkDesignFromPartner(design.id)
  const { mutateAsync: cancelAssignment, isPending: isCancelling } = useCancelPartnerAssignment(design.id)
  const { production_runs = [] } = useProductionRuns({
    design_id: design.id,
    limit: 50,
    offset: 0,
  })

  const metadata = (design as any)?.metadata || {}

  // Check if a partner has a production run — prefer active runs over cancelled ones
  const partnerRunStatus = (partnerId: string) => {
    const partnerRuns = production_runs.filter((r: any) => r.partner_id === partnerId)
    if (!partnerRuns.length) return null
    // Prefer active run status; fall back to cancelled/completed
    const active = partnerRuns.find(
      (r: any) => r.status !== "cancelled" && r.status !== "completed"
    )
    if (active) return String(active.status || "assigned")
    // All runs are terminal — show the most recent one
    const sorted = [...partnerRuns].sort(
      (a: any, b: any) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    )
    return String(sorted[0].status || "assigned")
  }

  const hasActiveRun = (partnerId: string) => {
    return production_runs.some(
      (r: any) =>
        r.partner_id === partnerId &&
        r.status !== "completed" &&
        r.status !== "cancelled"
    )
  }

  // Detect v1 workflow: design has partner_status in metadata but no active production run for this partner
  const hasV1Assignment = (partnerId: string) => {
    const ps = metadata.partner_status
    if (!ps || ps === "completed" || ps === "cancelled") return false
    // Only count non-cancelled, non-completed production runs
    const hasActiveRun = production_runs.some(
      (r: any) =>
        r.partner_id === partnerId &&
        r.status !== "cancelled" &&
        r.status !== "completed"
    )
    return !hasActiveRun
  }

  // Was assignment cancelled?
  const wasV1Cancelled = !!metadata.partner_assignment_cancelled_at

  const handleSendToPartner = async (e: React.MouseEvent, partnerId: string) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await sendDesign({ partnerId })
      toast.success("Design sent to partner. Workflow triggered.")
    } catch (err: any) {
      toast.error(err?.message || "Failed to send design to partner")
    }
  }

  const handleUnlinkPartner = async (e: React.MouseEvent, partnerId: string) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await unlinkPartner({ partnerId })
      toast.success("Partner unlinked from design")
    } catch (err: any) {
      toast.error(err?.message || "Failed to unlink partner")
    }
  }

  const handleCancelAssignment = async (e: React.MouseEvent, partnerId: string) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await cancelAssignment({ partner_id: partnerId })
      toast.success("Partner assignment cancelled")
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel assignment")
    }
  }

  const isAnyLoading = isSending || isUnlinking || isCancelling

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Partners</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Partners who can produce this design
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Link Partner",
                  icon: <Plus />,
                  onClick: () => {
                    navigate(`/designs/${design.id}/linkPartner`);
                  },
                },
              ],
            },
          ]}
        />
      </div>
      <div className="txt-small flex flex-col gap-2 px-1 pb-2">
        {!partners.length ? (
          <div className="flex items-center justify-center py-4 w-full">
            <Text className="text-ui-fg-subtle">No partners linked to this design</Text>
          </div>
        ) : (
          partners.map((partner) => {
            const link = `/partners/${partner.id}`;
            const runStatus = partnerRunStatus(partner.id)
            const canUnlink = !hasActiveRun(partner.id) && !hasV1Assignment(partner.id)
            const isV1Active = hasV1Assignment(partner.id)

            const Inner = (
              <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                <div className="flex items-center gap-3">
                  <Avatar src={partner.logo || undefined} fallback={partner.name?.charAt(0) || 'P'} />
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="text-ui-fg-base font-medium">
                      {partner.name || `Partner ${partner.id}`}
                    </span>
                    <span className="text-ui-fg-subtle truncate max-w-[150px] sm:max-w-[200px] md:max-w-full block">
                      {partner.handle || "-"}
                    </span>
                    {isV1Active && (
                      <span className="text-ui-fg-muted text-xs">
                        v1 workflow · {metadata.partner_status}
                      </span>
                    )}
                    {wasV1Cancelled && !isV1Active && !runStatus && (
                      <span className="text-ui-fg-error text-xs">
                        Assignment was cancelled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Production run status badge */}
                    {runStatus && (
                      <Badge color={
                        runStatus === "completed" ? "green" :
                        runStatus === "cancelled" ? "red" : "orange"
                      }>
                        {runStatus === "sent_to_partner" ? "Sent" : runStatus.replace(/_/g, " ")}
                      </Badge>
                    )}

                    {/* v1 active: show status + cancel button */}
                    {isV1Active && (
                      <>
                        <Badge color="orange">
                          {String(metadata.partner_status).replace(/_/g, " ")}
                        </Badge>
                        <Button
                          size="small"
                          variant="danger"
                          isLoading={isCancelling}
                          disabled={isAnyLoading}
                          onClick={(e) => handleCancelAssignment(e, partner.id)}
                        >
                          <XCircle className="mr-1" />
                          Cancel
                        </Button>
                      </>
                    )}

                    {/* No run, no v1, not cancelled: show Send button */}
                    {!runStatus && !isV1Active && !wasV1Cancelled && (
                      <Button
                        size="small"
                        variant="secondary"
                        isLoading={isSending}
                        disabled={isAnyLoading}
                        onClick={(e) => handleSendToPartner(e, partner.id)}
                      >
                        Send
                      </Button>
                    )}

                    {/* Unlink button: only when no active run and no active v1 */}
                    {canUnlink && (
                      <Button
                        size="small"
                        variant="transparent"
                        isLoading={isUnlinking}
                        disabled={isAnyLoading}
                        onClick={(e) => handleUnlinkPartner(e, partner.id)}
                      >
                        <Trash className="text-ui-fg-subtle" />
                      </Button>
                    )}
                    <div className="size-7 flex items-center justify-center">
                      <TriangleRightMini className="text-ui-fg-muted" />
                    </div>
                  </div>
                </div>
              </div>
            );

            return (
              <Link
                to={link}
                key={partner.id}
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                {Inner}
              </Link>
            );
          })
        )}
      </div>
    </Container>
  );
};
