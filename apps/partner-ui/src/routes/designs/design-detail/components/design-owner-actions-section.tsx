import { PencilSquare, PlaySolid, Plus, Trash } from "@medusajs/icons"
import { Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const prompt = usePrompt()
  const { mutateAsync } = useDeletePartnerDesign(design.id)

  const isOwner = !!design.is_owner
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
      title: t("partner.designs.ownerActions.deleteTitle"),
      description: t("partner.designs.ownerActions.deleteDescription", {
        name: design.name ?? design.id,
      }),
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    })
    if (!ok) return

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success(t("partner.designs.ownerActions.deleted"))
        navigate("/designs", { replace: true })
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <Container className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <Heading level="h2">
          {design.name || t("partner.designs.ownerActions.yourDesign")}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {hasActiveRun
            ? t("partner.designs.ownerActions.activeOrders", { count: activeRuns.length })
            : t("partner.designs.ownerActions.noOrders")}
        </Text>
      </div>
      <div className="flex items-center gap-x-2">
        {/* Absolute so this owner-mutation flow works whether the manager is
            standalone (/designs/:id) or nested under an order — the nested route
            has no production-run-create child. */}
        <Link to={`/designs/${design.id}/production-run-create`}>
          <Button
            size="small"
            variant={hasActiveRun ? "secondary" : "primary"}
            className="whitespace-nowrap"
          >
            {hasActiveRun ? <Plus /> : <PlaySolid />}
            {hasActiveRun
              ? t("partner.designs.ownerActions.newOrder")
              : t("partner.designs.ownerActions.createOrder")}
          </Button>
        </Link>
        <ActionMenu
          groups={[
            {
              actions: [
                { label: t("actions.edit"), icon: <PencilSquare />, to: "edit" },
              ],
            },
            {
              actions: [
                { label: t("actions.delete"), icon: <Trash />, onClick: handleDelete },
              ],
            },
          ]}
        />
      </div>
    </Container>
  )
}