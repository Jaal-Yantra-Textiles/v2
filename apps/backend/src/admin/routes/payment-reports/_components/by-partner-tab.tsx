import { Container, Text, Badge, Table, DatePicker, Label } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { usePaymentReportsByPartner } from "../../../hooks/api/payment-reports"

export const ByPartnerTab = () => {
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")

  const query = useMemo(
    () => ({
      ...(periodStart ? { period_start: periodStart } : {}),
      ...(periodEnd ? { period_end: periodEnd } : {}),
    }),
    [periodStart, periodEnd],
  )

  const { by_partner = [], isPending } = usePaymentReportsByPartner(query) as any

  return (
    <div className="flex flex-col gap-y-4 p-6">
      <Container className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-y-1">
            <Label>Period Start</Label>
            <DatePicker
              value={periodStart ? new Date(periodStart) : undefined}
              onChange={(date) => setPeriodStart(date ? date.toISOString().split("T")[0] : "")}
            />
          </div>
          <div className="grid gap-y-1">
            <Label>Period End</Label>
            <DatePicker
              value={periodEnd ? new Date(periodEnd) : undefined}
              onChange={(date) => setPeriodEnd(date ? date.toISOString().split("T")[0] : "")}
            />
          </div>
        </div>
      </Container>

      {isPending && <Text className="text-ui-fg-subtle">Loading...</Text>}

      <Container className="p-0">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Partner Name</Table.HeaderCell>
              <Table.HeaderCell>Total Amount</Table.HeaderCell>
              <Table.HeaderCell>Payment Count</Table.HeaderCell>
              <Table.HeaderCell>Status Breakdown</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {by_partner.length === 0 ? (
              <Table.Row>
                <Table.Cell {...{ colSpan: 4 } as any}>
                  <Text className="text-ui-fg-subtle">No data</Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              by_partner.map((row: any) => (
                <Table.Row key={row.partner_id}>
                  <Table.Cell>{row.partner_name}</Table.Cell>
                  <Table.Cell>₹{Number(row.total_amount).toLocaleString()}</Table.Cell>
                  <Table.Cell>{row.payment_count}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(row.by_status ?? {}).map(([s, c]) => (
                        <Badge key={s} color="grey" size="xsmall">
                          {s}: {String(c)}
                        </Badge>
                      ))}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </Container>
    </div>
  )
}
