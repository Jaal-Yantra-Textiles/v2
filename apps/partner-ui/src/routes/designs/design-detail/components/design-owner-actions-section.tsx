import { PencilSquare, PlaySolid, Plus, Trash } from "@medusajs/icons"
import { Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { Link, useNavigate } from "react-router-dom"

import { ActionMenu } from "../../../../components/common/action-menu"
import {
  PartnerDesign,
  useDeletePartnerDesign,
} from "../../../../hooks/api/partner-designs"
import { usePartnerProductionRuns } from "../../../../hooks/api/partner-production-runs"

const TERMINAL_RUN_STATUSES = ["completed", "cancelled"]

type Props = { design: PartnerDesign }

/**
 * Roadmap #6 Phase 1/4 — command header for a PARTNER-OWNED design.
 * Surfaces the primary action (Start production) front-and-center plus
 * an Edit/Delete menu. Only rendered when the design carries
 * `owner_partner_id` (the partner created it via self-serve);
 * admin-assigned designs stay read-only on the partner side.
 */
export const DesignOwnerActionsSection = ({ design }: Props) => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const { mutateAsync } = useDeletePartnerDesign(design.id)

  const isOwner = !!(design as any).owner_partner_id
  const { production_runs = [] } = usePartnerProductionRuns(
    { design_id: design.id, limit: 50 },
    { enabled: isOwner }
  )
  const activeRuns = production_runs.filter(
    (r: any) => !TERMINAL_RUN_STATUSES.includes(String(r.status))
  )
  const hasActiveRun = activeRuns.length > 0

  // Only the owner can manage. Admin-assigned designs have no
  // owner_partner_id and are read-only here.
  if (!isOwner) {
    return null
  }

  const handleDelete = async () => {
    const ok = await prompt({
      title: "Delete design",
      description: `Delete "${design.name ?? design.id}"? This can't be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!ok) return

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success("Design deleted")
        navigate("/designs", { replace: true })
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <Container className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <Heading level="h2">{design.name || "Your design"}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {hasActiveRun
            ? `${activeRuns.length} design order${activeRuns.length > 1 ? "s" : ""} in progress. Create another or hand one to a sub-partner.`
            : "You created this design. Create a design order to start production, or hand it to a sub-partner."}
        </Text>
      </div>
      <div className="flex items-center gap-x-2">
        <Link to="production-run-create">
          <Button
            size="small"
            variant={hasActiveRun ? "secondary" : "primary"}
            className="whitespace-nowrap"
          >
            {hasActiveRun ? <Plus /> : <PlaySolid />}
            {hasActiveRun ? "New order" : "Create order"}
          </Button>
        </Link>
        <ActionMenu
          groups={[
            {
              actions: [{ label: "Edit", icon: <PencilSquare />, to: "edit" }],
            },
            {
              actions: [
                { label: "Delete", icon: <Trash />, onClick: handleDelete },
              ],
            },
          ]}
        />
      </div>
    </Container>
  )
}
