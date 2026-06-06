import { PencilSquare, Trash } from "@medusajs/icons"
import { Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"

import { ActionMenu } from "../../../../components/common/action-menu"
import {
  PartnerDesign,
  useDeletePartnerDesign,
} from "../../../../hooks/api/partner-designs"

type Props = { design: PartnerDesign }

/**
 * Roadmap #6 Phase 1 — edit/delete actions for a PARTNER-OWNED design.
 * Only rendered when the design carries `owner_partner_id` (i.e. the
 * partner created it via self-serve); admin-assigned designs stay
 * read-only on the partner side.
 */
export const DesignOwnerActionsSection = ({ design }: Props) => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const { mutateAsync } = useDeletePartnerDesign(design.id)

  // Only the owner can manage. Admin-assigned designs have no
  // owner_partner_id and are read-only here.
  if (!(design as any).owner_partner_id) {
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
    <Container className="flex items-center justify-between px-6 py-4">
      <div>
        <Heading level="h2">Your design</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          You created this design — edit or delete it here.
        </Text>
      </div>
      <ActionMenu
        groups={[
          {
            actions: [
              { label: "Edit", icon: <PencilSquare />, to: "edit" },
            ],
          },
          {
            actions: [
              { label: "Delete", icon: <Trash />, onClick: handleDelete },
            ],
          },
        ]}
      />
    </Container>
  )
}
