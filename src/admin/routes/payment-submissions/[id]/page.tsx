import { UIMatch, useNavigate, useParams } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Badge,
  Table,
  toast,
  Button,
} from "@medusajs/ui"
import { CheckCircleSolid, XCircleSolid } from "@medusajs/icons"
import { Outlet } from "react-router-dom"
import {
  usePaymentSubmission,
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

const PaymentSubmissionDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  const {
    payment_submission: submission,
    isPending: isLoading,
    isError,
    error,
  } = usePaymentSubmission(id!) as any

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
  const items: any[] = submission.items || []
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
            <Heading>
              ₹{Number(submission.total_amount).toLocaleString()}
            </Heading>
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
        <Container className="p-0">
          <div className="border-b border-ui-border-base px-4 py-3">
            <Heading level="h3">Design Items</Heading>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Design</Table.HeaderCell>
                <Table.HeaderCell>Design ID</Table.HeaderCell>
                <Table.HeaderCell>Amount</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.length === 0 ? (
                <Table.Row>
                  <Table.Cell {...{ colSpan: 3 } as any}>
                    <Text className="text-ui-fg-subtle">
                      No items in this submission
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ) : (
                items.map((item: any) => (
                  <Table.Row key={item.id}>
                    <Table.Cell>
                      {item.design_name || "Unnamed design"}
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-xs">
                        {item.design_id}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      ₹{Number(item.amount).toLocaleString()}
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table>
        </Container>

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
