import { Button, Container, Heading, StatusBadge, Table, Text } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"

import { useQuoteBriefs } from "../../../hooks/api/quote-briefs"

/**
 * Quote briefs (#2608): the step BEFORE a priced quote. Several partners per
 * job, estimates where rates exist, the buyer's answers and our updates on one
 * link.
 */
export const BRIEF_STATUS: Record<string, { label: string; color: "grey" | "blue" | "orange" | "green" | "purple" | "red" }> = {
  draft: { label: "Draft (no link)", color: "grey" },
  open: { label: "Link sent", color: "blue" },
  submitted: { label: "Buyer sent", color: "orange" },
  sampling: { label: "Sampling", color: "purple" },
  quoted: { label: "Quoted", color: "green" },
  closed: { label: "Closed", color: "red" },
}

const QuoteBriefsPage = () => {
  const navigate = useNavigate()
  const { data, isLoading } = useQuoteBriefs({ limit: 50 })
  const rows = data?.briefs ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Briefs</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Before a quote: options, the partners per step, estimates, and what the buyer tells us.
          </Text>
        </div>
        <Button size="small" onClick={() => navigate("/quotes/briefs/create")}>
          New brief
        </Button>
      </div>
      {isLoading ? (
        <Text className="px-6 py-4 text-ui-fg-subtle">Loading…</Text>
      ) : !rows.length ? (
        <Text className="px-6 py-4 text-ui-fg-subtle">No briefs yet.</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Brief</Table.HeaderCell>
              <Table.HeaderCell>Buyer</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Views</Table.HeaderCell>
              <Table.HeaderCell>Created</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((b) => (
              <Table.Row key={b.id} className="cursor-pointer" onClick={() => navigate(`/quotes/briefs/${b.id}`)}>
                <Table.Cell>{b.title}</Table.Cell>
                <Table.Cell>{b.recipient_name || b.buyer_email || "—"}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={BRIEF_STATUS[b.status]?.color ?? "grey"}>
                    {BRIEF_STATUS[b.status]?.label ?? b.status}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>{b.view_count ?? 0}</Table.Cell>
                <Table.Cell>{new Date(b.created_at).toLocaleDateString()}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

export const handle = { breadcrumb: () => "Briefs" }

export default QuoteBriefsPage
