import { useParams } from "react-router-dom"
import {
  Badge,
  Container,
  Heading,
  Table,
  Text,
} from "@medusajs/ui"
import { Outlet } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"
import { usePartnerPaymentSubmission } from "../../../hooks/api/partner-payment-submissions"

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

export const PaymentSubmissionDetail = () => {
  const { id } = useParams()
  const { payment_submission: submission, isPending, isError, error } =
    usePartnerPaymentSubmission(id!)

  if (isPending || !submission) {
    return <SingleColumnPageSkeleton sections={3} />
  }

  if (isError) {
    throw error
  }

  const items: any[] = submission.items || []
  const designItems = items.filter(
    (i) => i.source_type === "design" || (!i.source_type && i.design_id)
  )
  const taskItems = items.filter(
    (i) => i.source_type === "task" || (!i.source_type && i.task_id)
  )
  const documents: any[] = submission.documents || []

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={true}>
      <div className="flex flex-col gap-y-4">
        {/* Header */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Heading>
                Submission {submission.id.slice(0, 8)}...
              </Heading>
              <Badge color={statusColor(submission.status)}>
                {submission.status.replace("_", " ")}
              </Badge>
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Total Amount
                </Text>
                <Text className="font-semibold">
                  {(submission.currency || "inr").toUpperCase()}{" "}
                  {Number(submission.total_amount).toLocaleString()}
                </Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Items
                </Text>
                <Text>
                  {designItems.length ? `${designItems.length} design${designItems.length !== 1 ? "s" : ""}` : ""}
                  {designItems.length && taskItems.length ? " · " : ""}
                  {taskItems.length ? `${taskItems.length} task${taskItems.length !== 1 ? "s" : ""}` : ""}
                  {!items.length ? 0 : ""}
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

        {/* Rejection Banner */}
        {submission.status === "Rejected" && submission.rejection_reason && (
          <Container className="border-ui-border-error bg-ui-bg-subtle-hover p-4">
            <div className="flex items-start gap-3">
              <Badge color="red">Rejected</Badge>
              <div>
                <Text weight="plus" className="mb-1">
                  Rejection Reason
                </Text>
                <Text className="text-ui-fg-subtle">
                  {submission.rejection_reason}
                </Text>
              </div>
            </div>
          </Container>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
            <Heading>{designItems.length}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Tasks
            </Text>
            <Heading>{taskItems.length}</Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Currency
            </Text>
            <Heading>
              {(submission.currency || "inr").toUpperCase()}
            </Heading>
          </Container>
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Documents
            </Text>
            <Heading>{documents.length}</Heading>
          </Container>
        </div>

        {/* Design Items */}
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
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {designItems.map((item: any) => (
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
                ))}
              </Table.Body>
            </Table>
          </Container>
        )}

        {/* Task Items */}
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
                      ₹{Number(item.amount).toLocaleString()}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Container>
        )}

        {!items.length && (
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
      <Outlet />
    </SingleColumnPage>
  )
}

export const Component = PaymentSubmissionDetail
export const Breadcrumb = () => "Submission Detail"
