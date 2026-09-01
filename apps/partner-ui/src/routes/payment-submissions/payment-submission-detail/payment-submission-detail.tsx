import { useParams } from "react-router-dom"
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { Outlet } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"
import {
  usePartnerPaymentSubmission,
  useSubmitPartnerPaymentSubmission,
} from "../../../hooks/api/partner-payment-submissions"
import {
  describeLine,
  money,
  perUnit,
  provenanceLabel,
  summariseItems,
} from "../../../lib/payment-submission-money"

/** The provenance note, rendered. The decision itself lives in `src/lib`. */
const ProvenanceNote = ({ item }: { item: any }) => {
  const label = provenanceLabel(item)
  if (!label) return null

  return (
    <Text
      size="xsmall"
      className={label.muted ? "text-ui-fg-muted" : "text-ui-fg-subtle"}
    >
      {label.text}
    </Text>
  )
}

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
  // Above the early returns — a conditionally-called hook changes the hook
  // order between renders and React throws.
  const submitDraft = useSubmitPartnerPaymentSubmission()

  if (isPending || !submission) {
    return <SingleColumnPageSkeleton sections={3} />
  }

  if (isError) {
    throw error
  }

  const items: any[] = submission.items || []

  /**
   * 🔴 ONE list of lines, not a table per source type (#1710, #1621).
   *
   * This screen used to partition `items` into `designItems` and `taskItems`
   * and render a table for each. `source_type` has FOUR values — `design`,
   * `task`, `run`, `inventory_order` — so a line sourced from a production run
   * or from an inventory order matched neither filter and rendered NOWHERE. It
   * still counted toward `total_amount` in the header, so the page showed a
   * total with no lines adding up to it, and a partner billing for goods saw
   * an empty submission.
   *
   * 🔑 The fix for a filter that enumerates known values is to REMOVE the
   * partitioning, not to add a fourth branch — the next source type would
   * disappear the same way. `describeLine` below labels whatever arrives, and
   * an unrecognised type still gets a row.
   */
  const designItems = items.filter(
    (i) => i.source_type === "design" || (!i.source_type && i.design_id)
  )
  const taskItems = items.filter(
    (i) => i.source_type === "task" || (!i.source_type && i.task_id)
  )
  const goodsItems = items.filter((i) => i.source_type === "inventory_order")
  const documents: any[] = submission.documents || []
  const currency: string | undefined = (submission as any).currency

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={true}>
      <div className="flex flex-col gap-y-4">
        {/* Header */}
        <Container className="divide-y p-0">
          <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Heading>
                Submission {submission.id.slice(0, 8)}...
              </Heading>
              <Badge color={statusColor(submission.status)}>
                {submission.status.replace("_", " ")}
              </Badge>
            </div>
            {/**
              * 🔴 The button this screen never had (#1604).
              *
              * A Draft is pre-filled for you when a production run completes —
              * amount, units and the runs it pays for. Until now the only way
              * to bill it was to start a NEW submission by hand, which could
              * not name those runs and so recorded no evidence of what it was
              * for. Submitting the draft in place keeps that evidence, which is
              * what lets the same work be refused a second time.
              */}
            {submission.status === "Draft" && (
              <Button
                size="small"
                isLoading={submitDraft.isPending}
                onClick={async () => {
                  try {
                    await submitDraft.mutateAsync({
                      submissionId: submission.id,
                    })
                    toast.success("Submitted for review")
                  } catch (e: any) {
                    toast.error(
                      e?.message || "Could not submit this draft"
                    )
                  }
                }}
              >
                Submit for review
              </Button>
            )}
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
                {/*
                  ⚠️ Counts every line, including the ones this summary used to
                  omit. It listed designs and tasks only, so a submission of
                  three inventory-order lines read as an empty item count while
                  the total beside it was in five figures (#1710).
                */}
                <Text>{summariseItems(items) || 0}</Text>
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <Container className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Total Amount
            </Text>
            <Heading>
              {money(submission.total_amount, currency)}
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
              Goods
            </Text>
            <Heading>{goodsItems.length}</Heading>
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

        {/*
          Every line, whatever its source (#1710).

          🔴 Replaces the "Design Items" and "Task Items" tables. Those two
          between them could render `design` and `task` lines only, so a `run`
          or `inventory_order` line was invisible while still counting toward
          the total in the header above.
        */}
        {items.length > 0 && (
          <Container className="p-0">
            <div className="border-b border-ui-border-base px-4 py-3">
              <Heading level="h3">What this bills for</Heading>
            </div>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Item</Table.HeaderCell>
                  <Table.HeaderCell>Billed for</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((item: any) => {
                  const line = describeLine(item)
                  return (
                    <Table.Row key={item.id}>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <Text size="small">{line.title}</Text>
                          <Badge color={line.badgeColor} size="2xsmall">
                            {line.badge}
                          </Badge>
                        </div>
                        {line.subtitle && (
                          <Text size="xsmall" className="mt-1 text-ui-fg-muted font-mono">
                            {line.subtitle}
                          </Text>
                        )}
                      </Table.Cell>
                      {/*
                        The design id used to sit here. It answers a question
                        nobody asks on a payment screen; "what am I being paid
                        for, and at what rate" is the question, and the create
                        screen has answered it since #1579 while this one did
                        not — the two money screens disagreed about what a
                        submission even was.
                      */}
                      <Table.Cell>
                        <div className="flex flex-col">
                          <Text size="small">
                            {perUnit(item, currency) ?? line.billedFor}
                          </Text>
                          <ProvenanceNote item={item} />
                        </div>
                      </Table.Cell>
                      <Table.Cell>{money(item.amount, currency)}</Table.Cell>
                    </Table.Row>
                  )
                })}
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
