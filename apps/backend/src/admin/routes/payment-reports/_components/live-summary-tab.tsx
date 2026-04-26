import { Container, Heading, Text, Badge, Table, DatePicker, Label, Select } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { usePaymentReportSummary } from "../../../hooks/api/payment-reports"

export const LiveSummaryTab = () => {
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [status, setStatus] = useState("__all__")
  const [paymentType, setPaymentType] = useState("__all__")

  const query = useMemo(
    () => ({
      ...(periodStart ? { period_start: periodStart } : {}),
      ...(periodEnd ? { period_end: periodEnd } : {}),
      ...(status !== "__all__" ? { status: status as any } : {}),
      ...(paymentType !== "__all__" ? { payment_type: paymentType as any } : {}),
    }),
    [periodStart, periodEnd, status, paymentType],
  )

  const enabled = !!(periodStart || periodEnd || status !== "__all__" || paymentType !== "__all__")

  const {
    total_amount = 0,
    payment_count = 0,
    by_status = {},
    by_type = {},
    by_month = [],
    isPending,
  } = usePaymentReportSummary(query, { enabled }) as any

  return (
    <div className="flex flex-col gap-y-4 p-6">
      {/* Filters */}
      <Container className="p-4">
        <Heading level="h3" className="mb-4">Filters</Heading>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
          <div className="grid gap-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="__all__">All Statuses</Select.Item>
                <Select.Item value="Pending">Pending</Select.Item>
                <Select.Item value="Processing">Processing</Select.Item>
                <Select.Item value="Completed">Completed</Select.Item>
                <Select.Item value="Failed">Failed</Select.Item>
                <Select.Item value="Cancelled">Cancelled</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="grid gap-y-1">
            <Label>Payment Type</Label>
            <Select value={paymentType} onValueChange={setPaymentType}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="__all__">All Types</Select.Item>
                <Select.Item value="Bank">Bank</Select.Item>
                <Select.Item value="Cash">Cash</Select.Item>
                <Select.Item value="Digital_Wallet">Digital Wallet</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </div>
      </Container>

      {isPending && <Text className="text-ui-fg-subtle">Loading...</Text>}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Container className="p-4">
          <Text size="small" className="text-ui-fg-subtle">Total Amount</Text>
          <Heading>₹{Number(total_amount).toLocaleString()}</Heading>
        </Container>
        <Container className="p-4">
          <Text size="small" className="text-ui-fg-subtle">Payment Count</Text>
          <Heading>{payment_count}</Heading>
        </Container>
        <Container className="p-4">
          <Text size="small" className="text-ui-fg-subtle">Statuses</Text>
          <Heading>{Object.keys(by_status).length}</Heading>
        </Container>
        <Container className="p-4">
          <Text size="small" className="text-ui-fg-subtle">Payment Types</Text>
          <Heading>{Object.keys(by_type).length}</Heading>
        </Container>
      </div>

      {/* By Status */}
      {Object.keys(by_status).length > 0 && (
        <Container className="p-4">
          <Heading level="h3" className="mb-3">By Status</Heading>
          <div className="flex flex-wrap gap-2">
            {Object.entries(by_status).map(([s, c]) => (
              <Badge key={s} color="grey">
                {s}: {String(c)}
              </Badge>
            ))}
          </div>
        </Container>
      )}

      {/* By Type */}
      {Object.keys(by_type).length > 0 && (
        <Container className="p-4">
          <Heading level="h3" className="mb-3">By Payment Type</Heading>
          <div className="flex flex-col gap-y-1">
            {Object.entries(by_type).map(([t, amount]) => (
              <div key={t} className="flex justify-between">
                <Text>{t}</Text>
                <Text className="text-ui-fg-subtle">₹{Number(amount).toLocaleString()}</Text>
              </div>
            ))}
          </div>
        </Container>
      )}

      {/* By Month */}
      {Array.isArray(by_month) && by_month.length > 0 && (
        <Container className="p-0">
          <div className="px-4 py-3 border-b border-ui-border-base">
            <Heading level="h3">By Month</Heading>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Month</Table.HeaderCell>
                <Table.HeaderCell>Amount</Table.HeaderCell>
                <Table.HeaderCell>Count</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {by_month.map((row: any) => (
                <Table.Row key={row.month}>
                  <Table.Cell>{row.month}</Table.Cell>
                  <Table.Cell>₹{Number(row.amount).toLocaleString()}</Table.Cell>
                  <Table.Cell>{row.count}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}
    </div>
  )
}
