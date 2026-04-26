import { UIMatch, useNavigate, useParams } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  Input,
  Label,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useState } from "react"
import {
  useReconciliation,
  useUpdateReconciliation,
  useSettleReconciliation,
  type PaymentReconciliation,
} from "../../../../hooks/api/payment-submissions"

const statusColor = (
  status: string
): "green" | "orange" | "red" | "grey" | "blue" | "purple" => {
  switch (status) {
    case "Matched":
      return "green"
    case "Settled":
      return "blue"
    case "Pending":
      return "orange"
    case "Discrepant":
      return "red"
    case "Waived":
      return "grey"
    default:
      return "grey"
  }
}

const ReconciliationDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const prompt = usePrompt()

  const {
    reconciliation,
    isPending: isLoading,
    isError,
    error,
  } = useReconciliation(id!) as any

  const { mutateAsync: update, isPending: isUpdating } =
    useUpdateReconciliation()
  const { mutateAsync: settle, isPending: isSettling } =
    useSettleReconciliation()

  const [editActual, setEditActual] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [showEdit, setShowEdit] = useState(false)

  if (isLoading || !reconciliation) {
    return (
      <div className="flex flex-col gap-y-4 p-4">
        <Text className="text-ui-fg-subtle">Loading...</Text>
      </div>
    )
  }

  if (isError) {
    throw error
  }

  const canSettle =
    reconciliation.status !== "Settled" && reconciliation.status !== "Waived"

  const handleSettle = async () => {
    const confirmed = await prompt({
      title: "Settle Reconciliation",
      description:
        "Mark this reconciliation as settled. This action records the current discrepancy as resolved.",
    })
    if (!confirmed) return

    try {
      await settle({ id: id! })
      toast.success("Reconciliation settled")
    } catch (e: any) {
      toast.error(e?.message || "Failed to settle")
    }
  }

  const handleWaive = async () => {
    const confirmed = await prompt({
      title: "Waive Discrepancy",
      description:
        "Mark this discrepancy as waived. This will not create any additional payments.",
    })
    if (!confirmed) return

    try {
      await update({ id: id!, status: "Waived" })
      toast.success("Discrepancy waived")
    } catch (e: any) {
      toast.error(e?.message || "Failed to waive")
    }
  }

  const handleUpdate = async () => {
    try {
      const payload: any = { id: id! }
      if (editActual) payload.actual_amount = Number(editActual)
      if (editNotes) payload.notes = editNotes
      await update(payload)
      toast.success("Reconciliation updated")
      setShowEdit(false)
      setEditActual("")
      setEditNotes("")
    } catch (e: any) {
      toast.error(e?.message || "Failed to update")
    }
  }

  return (
    <div className="flex flex-col gap-y-4">
      {/* Header */}
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Heading>
              Reconciliation {reconciliation.id.slice(0, 8)}...
            </Heading>
            <Badge color={statusColor(reconciliation.status)}>
              {reconciliation.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {canSettle && (
              <>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setShowEdit(!showEdit)}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleWaive}
                >
                  Waive
                </Button>
                <Button size="small" onClick={handleSettle}>
                  Settle
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Reference Type
              </Text>
              <Badge color="grey">
                {reconciliation.reference_type.replace("_", " ")}
              </Badge>
            </div>
            {reconciliation.reference_id && (
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Reference ID
                </Text>
                <Text className="font-mono text-xs">
                  {reconciliation.reference_id}
                </Text>
              </div>
            )}
            {reconciliation.partner_id && (
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Partner ID
                </Text>
                <Text className="font-mono text-xs">
                  {reconciliation.partner_id}
                </Text>
              </div>
            )}
            {reconciliation.payment_id && (
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Payment ID
                </Text>
                <Text className="font-mono text-xs">
                  {reconciliation.payment_id}
                </Text>
              </div>
            )}
            {reconciliation.settled_at && (
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Settled At
                </Text>
                <Text>
                  {new Date(reconciliation.settled_at).toLocaleString()}
                </Text>
              </div>
            )}
            {reconciliation.settled_by && (
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Settled By
                </Text>
                <Text className="font-mono text-xs">
                  {reconciliation.settled_by}
                </Text>
              </div>
            )}
            {reconciliation.notes && (
              <div className="col-span-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Notes
                </Text>
                <Text>{reconciliation.notes}</Text>
              </div>
            )}
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Created
              </Text>
              <Text>
                {new Date(reconciliation.created_at).toLocaleString()}
              </Text>
            </div>
          </div>
        </div>
      </Container>

      {/* Amount Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Container className="p-4">
          <Text size="small" className="text-ui-fg-subtle">
            Expected Amount
          </Text>
          <Heading>
            ₹{Number(reconciliation.expected_amount).toLocaleString()}
          </Heading>
        </Container>
        <Container className="p-4">
          <Text size="small" className="text-ui-fg-subtle">
            Actual Amount
          </Text>
          <Heading>
            {reconciliation.actual_amount != null
              ? `₹${Number(reconciliation.actual_amount).toLocaleString()}`
              : "—"}
          </Heading>
        </Container>
        <Container className="p-4">
          <Text size="small" className="text-ui-fg-subtle">
            Discrepancy
          </Text>
          <Heading>
            {reconciliation.discrepancy != null ? (
              <span
                className={
                  Number(reconciliation.discrepancy) === 0
                    ? ""
                    : Number(reconciliation.discrepancy) > 0
                      ? "text-ui-fg-positive"
                      : "text-ui-fg-error"
                }
              >
                {Number(reconciliation.discrepancy) > 0 ? "+" : ""}₹
                {Number(reconciliation.discrepancy).toLocaleString()}
              </span>
            ) : (
              "—"
            )}
          </Heading>
        </Container>
      </div>

      {/* Edit Panel */}
      {showEdit && (
        <Container className="p-4">
          <Heading level="h3" className="mb-3">
            Update Reconciliation
          </Heading>
          <div className="flex flex-col gap-y-3">
            <div className="flex flex-col gap-y-1">
              <Label>Actual Amount</Label>
              <Input
                type="number"
                placeholder={String(reconciliation.actual_amount ?? "")}
                value={editActual}
                onChange={(e) => setEditActual(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <Label>Notes</Label>
              <Textarea
                placeholder="Add notes..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                onClick={() => setShowEdit(false)}
              >
                Cancel
              </Button>
              <Button
                size="small"
                onClick={handleUpdate}
                isLoading={isUpdating}
              >
                Save
              </Button>
            </div>
          </div>
        </Container>
      )}
    </div>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `Reconciliation ${id}`
  },
}

export default ReconciliationDetailPage
