import { UIMatch, useNavigate, useParams } from "react-router-dom"
import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  Badge,
  Table,
  toast,
  Button,
  Input,
  Prompt,
} from "@medusajs/ui"
import { CheckCircleSolid, PencilSquare, Trash, XCircleSolid } from "@medusajs/icons"
import { Outlet } from "react-router-dom"
import {
  useDeletePaymentSubmission,
  usePaymentSubmission,
  useSubmitPaymentSubmission,
  useUpdatePaymentSubmissionItem,
  type PaymentSubmission,
} from "../../../hooks/api/payment-submissions"

const statusColor = (
  status: string
): "green" | "orange" | "red" | "grey" | "blue" | "purple" => {
  switch (status) {
    case "Paid":
      return "green"
    case "Approved":
      return "blue"
    case "Pending":
    case "Under_Review":
      return "orange"
    case "Rejected":
      return "red"
    default:
      return "grey"
  }
}

/**
 * ⚠️ `currency` is a real column that merely DEFAULTS to inr. Hardcoding ₹ told
 * a partner billing in another currency the wrong thing in the one place they
 * check what they are owed.
 */
const money = (amount: number | string, currency?: string | null) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: (currency || "inr").toUpperCase(),
    maximumFractionDigits: 2,
  }).format(Number(amount || 0))

/**
 * Inline correction of one line (#1604).
 *
 * `audit-partner-payout-quantity` reports the lines that need a human decision
 * and deliberately refuses to write them — "the correction is a payment
 * decision rather than a data repair". This is where that decision is made. It
 * edits the BREAKDOWN (units and rate) rather than the total, because a total
 * typed over a rate throws away the "9 × 850" that lets a partner check the
 * number instead of taking it on trust.
 */
const EditableLine = ({
  item,
  submissionId,
  currency,
  editable,
}: {
  item: any
  submissionId: string
  currency?: string | null
  editable: boolean
}) => {
  const [editing, setEditing] = useState(false)
  const [quantity, setQuantity] = useState(String(item.quantity ?? 1))
  const [unitAmount, setUnitAmount] = useState(
    item.unit_amount === null || item.unit_amount === undefined
      ? ""
      : String(item.unit_amount)
  )

  const { mutateAsync, isPending } = useUpdatePaymentSubmissionItem()

  const save = async () => {
    const payload: Record<string, number> = {}
    const q = Number(quantity)
    if (Number.isFinite(q) && q > 0 && q !== Number(item.quantity ?? 1)) {
      payload.quantity = q
    }
    const u = Number(unitAmount)
    if (Number.isFinite(u) && u > 0 && u !== Number(item.unit_amount ?? NaN)) {
      payload.unit_amount = u
    }
    if (!Object.keys(payload).length) {
      setEditing(false)
      return
    }

    try {
      await mutateAsync({ id: submissionId, item_id: item.id, ...payload })
      toast.success("Line updated")
      setEditing(false)
    } catch (e: any) {
      // The server owns the guards — a refusal here is the double-pay check or
      // the status contract talking, and its wording is the useful part.
      toast.error(e?.message || "Could not update the line")
    }
  }

  return (
    <Table.Row>
      <Table.Cell>{item.design_name || "Unnamed design"}</Table.Cell>
      <Table.Cell>
        <span className="font-mono text-xs">{item.design_id}</span>
      </Table.Cell>
      <Table.Cell>
        {editing ? (
          <Input
            size="small"
            className="w-20"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        ) : (
          Number(item.quantity ?? 1)
        )}
      </Table.Cell>
      <Table.Cell>
        {editing ? (
          <Input
            size="small"
            className="w-28"
            value={unitAmount}
            placeholder="rate"
            onChange={(e) => setUnitAmount(e.target.value)}
          />
        ) : item.unit_amount === null || item.unit_amount === undefined ? (
          // A typed total has no rate behind it, and dividing the total back
          // out would invent one.
          <Text size="small" className="text-ui-fg-muted">
            typed total
          </Text>
        ) : (
          money(item.unit_amount, currency)
        )}
      </Table.Cell>
      <Table.Cell>{money(item.amount, currency)}</Table.Cell>
      <Table.Cell>
        {/* Whether the runs behind this money are known at all (#1565). */}
        <Badge
          size="2xsmall"
          color={
            item.run_provenance === "recorded"
              ? "green"
              : item.run_provenance === "no_run"
                ? "grey"
                : "orange"
          }
        >
          {item.run_provenance === "recorded"
            ? `${(item.production_run_ids || []).length} run(s)`
            : item.run_provenance === "no_run"
              ? "no run"
              : "not recorded"}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        {editable &&
          (editing ? (
            <div className="flex gap-1">
              <Button
                size="small"
                variant="secondary"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button size="small" isLoading={isPending} onClick={save}>
                Save
              </Button>
            </div>
          ) : (
            <Button
              size="small"
              variant="transparent"
              onClick={() => setEditing(true)}
            >
              <PencilSquare />
            </Button>
          ))}
      </Table.Cell>
    </Table.Row>
  )
}

const PaymentSubmissionDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  const {
    payment_submission: submission,
    isPending: isLoading,
    isError,
    error,
  } = usePaymentSubmission(id!) as any

  // 🔴 Declared before the loading/error early-returns. A hook called
  // conditionally changes the hook order between renders and React throws.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const submitDraft = useSubmitPaymentSubmission()
  const deleteDraft = useDeletePaymentSubmission()

  if (isLoading || !submission) {
    return (
      <div className="flex flex-col gap-y-4 p-4">
        <Text className="text-ui-fg-subtle">Loading...</Text>
      </div>
    )
  }

  if (isError) {
    throw error
  }

  const isReviewable =
    submission.status === "Pending" || submission.status === "Under_Review"
  /**
   * A Draft is machine-written and was, until #1604, a dead end: `review`
   * refuses anything that is not Pending or Under_Review, nothing converted it,
   * and nothing removed it. Seven piled up on production.
   */
  const isDraft = submission.status === "Draft"
  /** Lines are editable only while the money has not moved. */
  const linesEditable = isDraft || submission.status === "Pending"
  const items: any[] = submission.items || []
  const designItems = items.filter(
    (i) => i.source_type === "design" || (!i.source_type && i.design_id)
  )
  const taskItems = items.filter(
    (i) => i.source_type === "task" || (!i.source_type && i.task_id)
  )
  const documents: any[] = submission.documents || []

  return (
    <>
      <div className="flex flex-col gap-y-4">
        {/* Header */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Heading>Submission {submission.id.slice(0, 8)}...</Heading>
              <Badge color={statusColor(submission.status)}>
                {submission.status.replace("_", " ")}
              </Badge>
            </div>
            {isDraft && (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash className="mr-1" />
                  Delete draft
                </Button>
                <Button
                  size="small"
                  isLoading={submitDraft.isPending}
                  onClick={async () => {
                    try {
                      await submitDraft.mutateAsync({ id: submission.id })
                      toast.success("Submitted for review")
                    } catch (e: any) {
                      toast.error(e?.message || "Could not submit this draft")
                    }
                  }}
                >
                  <CheckCircleSolid className="mr-1" />
                  Submit for review
                </Button>
              </div>
            )}
            {isReviewable && (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => navigate("review?action=reject")}
                >
                  <XCircleSolid className="mr-1" />
                  Reject
                </Button>
                <Button
                  size="small"
                  onClick={() => navigate("review?action=approve")}
                >
                  <CheckCircleSolid className="mr-1" />
                  Approve
                </Button>
              </div>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Partner ID
                </Text>
                <Text className="font-mono text-xs">
                  {submission.partner_id}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Total Amount
                </Text>
                <Text>
                  {submission.currency?.toUpperCase() || "INR"}{" "}
                  {Number(submission.total_amount).toLocaleString()}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Submitted
                </Text>
                <Text>
                  {submission.submitted_at
                    ? new Date(submission.submitted_at).toLocaleString()
                    : "—"}
                </Text>
              </div>
              {submission.reviewed_at && (
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Reviewed
                  </Text>
                  <Text>
                    {new Date(submission.reviewed_at).toLocaleString()}
                  </Text>
                </div>
              )}
              {submission.reviewed_by && (
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Reviewed By
                  </Text>
                  <Text className="font-mono text-xs">
                    {submission.reviewed_by}
                  </Text>
                </div>
              )}
              {submission.rejection_reason && (
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Rejection Reason
                  </Text>
                  <Text className="text-ui-fg-error">
                    {submission.rejection_reason}
                  </Text>
                </div>
              )}
              {submission.notes && (
                <div className="col-span-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    Notes
                  </Text>
                  <Text>{submission.notes}</Text>
                </div>
              )}
            </div>
          </div>
        </Container>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Total Amount
            </Text>
            <Heading>{money(submission.total_amount, submission.currency)}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Designs
            </Text>
            <Heading>{items.length}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Currency
            </Text>
            <Heading>{(submission.currency || "inr").toUpperCase()}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Documents
            </Text>
            <Heading>{documents.length}</Heading>
          </Container>
        </div>

        {/* Design Items Table */}
        {designItems.length > 0 && (
          <Container className="p-0">
            <div className="border-b border-ui-border-base px-4 py-3">
              <Heading level="h3">Design Items</Heading>
            </div>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Design</Table.HeaderCell>
                  <Table.HeaderCell>Design ID</Table.HeaderCell>
                  {/* The breakdown, so a partner reads "9 x 850" rather than a
                      bare total they have to take on trust (#1554). */}
                  <Table.HeaderCell>Units</Table.HeaderCell>
                  <Table.HeaderCell>Rate</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                  <Table.HeaderCell>Runs</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {designItems.map((item: any) => (
                  <EditableLine
                    key={item.id}
                    item={item}
                    submissionId={submission.id}
                    currency={submission.currency}
                    editable={linesEditable}
                  />
                ))}
              </Table.Body>
            </Table>
          </Container>
        )}

        {/* Task Items Table */}
        {taskItems.length > 0 && (
          <Container className="p-0">
            <div className="border-b border-ui-border-base px-4 py-3">
              <Heading level="h3">Task Items</Heading>
            </div>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Task</Table.HeaderCell>
                  <Table.HeaderCell>Task ID</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {taskItems.map((item: any) => (
                  <Table.Row key={item.id}>
                    <Table.Cell>
                      {item.task_name || "Untitled task"}
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-xs">
                        {item.task_id}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      {money(item.amount, submission.currency)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Container>
        )}

        {items.length === 0 && (
          <Container className="p-6">
            <Text className="text-ui-fg-subtle text-center">
              No items in this submission
            </Text>
          </Container>
        )}

        {/* Documents */}
        {documents.length > 0 && (
          <Container className="p-0">
            <div className="border-b border-ui-border-base px-4 py-3">
              <Heading level="h3">Documents</Heading>
            </div>
            <div className="flex flex-col gap-2 p-4">
              {documents.map((doc: any, i: number) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ui-fg-interactive underline text-sm"
                >
                  {doc.filename || doc.url}
                </a>
              ))}
            </div>
          </Container>
        )}
      </div>
      {/**
        * A Draft is machine-written, so removing one is routine — but it is
        * still a delete, and the route refuses anything that has been
        * submitted. Confirm rather than fire on a stray click.
        */}
      <Prompt open={confirmDelete} onOpenChange={setConfirmDelete}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Delete this draft?</Prompt.Title>
            <Prompt.Description>
              Drafts are pre-filled automatically when a production run
              completes. Deleting this one releases the design and its runs so
              they can be billed again. Nothing that has been submitted,
              approved or paid can be deleted.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action
              onClick={async () => {
                try {
                  await deleteDraft.mutateAsync({ id: submission.id })
                  toast.success("Draft deleted")
                  navigate("/payment-submissions")
                } catch (e: any) {
                  toast.error(e?.message || "Could not delete this draft")
                }
              }}
            >
              Delete
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>

      <Outlet />
    </>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `${id}`
  },
}

export default PaymentSubmissionDetailPage
