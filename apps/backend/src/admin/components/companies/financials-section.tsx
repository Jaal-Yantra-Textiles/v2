import {
  Badge,
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useCompanyCapTables } from "../../hooks/api/cap-tables-admin"
import {
  useCompanyPayments,
  useRecordPayment,
} from "../../hooks/api/investor-financials-admin"

const PAYMENT_TYPES = ["subscription", "capital_call", "top_up", "transfer_fee", "other"] as const
const PAYMENT_STATUSES = ["pending", "in_progress", "completed", "failed", "refunded", "cancelled"] as const
const PAYMENT_METHODS = ["bank_transfer", "card", "upi", "wallet", "cheque", "other"] as const

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const paymentStatusColor = (s?: string): "green" | "orange" | "red" | "grey" => {
  switch (s) {
    case "completed":
      return "green"
    case "pending":
    case "in_progress":
      return "orange"
    case "failed":
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
}

const RecordPaymentModal = ({ companyId }: { companyId: string }) => {
  const [open, setOpen] = useState(false)
  const form = useForm({
    defaultValues: {
      amount: "",
      currency_code: "USD",
      payment_type: "subscription",
      status: "pending",
      method: "bank_transfer",
      reference_number: "",
      notes: "",
    },
  })
  const { mutateAsync, isPending } = useRecordPayment(companyId, {
    onSuccess: () => {
      toast.success("Payment recorded")
      form.reset()
      setOpen(false)
    },
    onError: (e) => toast.error(e?.message || "Failed to record payment"),
  })
  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      amount: Number(v.amount),
      currency_code: v.currency_code || undefined,
      payment_type: v.payment_type,
      status: v.status,
      method: v.method,
      reference_number: v.reference_number || null,
      notes: v.notes || null,
    })
  )
  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Record payment</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>Save</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-8">
          <form onSubmit={onSubmit} className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading level="h2">Record a payment</Heading>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Amount</Label>
                <Input type="number" {...form.register("amount", { required: true })} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Currency (ISO)</Label>
                <Input {...form.register("currency_code")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Type</Label>
                <Controller control={form.control} name="payment_type" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {PAYMENT_TYPES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                    </Select.Content>
                  </Select>
                )} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Status</Label>
                <Controller control={form.control} name="status" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {PAYMENT_STATUSES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                    </Select.Content>
                  </Select>
                )} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Method</Label>
                <Controller control={form.control} name="method" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {PAYMENT_METHODS.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                    </Select.Content>
                  </Select>
                )} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Reference</Label>
                <Input {...form.register("reference_number")} />
              </div>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Notes</Label>
              <Input {...form.register("notes")} />
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

export const FinancialsSection = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { payments = [], isPending } = useCompanyPayments(companyId)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Financials</Heading>
        <RecordPaymentModal companyId={companyId} />
      </div>

      {/* Valuation summary (from the company's cap table) */}
      <div className="grid grid-cols-2 gap-4 px-6 py-5 md:grid-cols-3">
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Pre-money</Text>
          <Text weight="plus" className="mt-1">
            {money(capTable?.pre_money_valuation, capTable?.currency_code)}
          </Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Post-money</Text>
          <Text weight="plus" className="mt-1">
            {money(capTable?.post_money_valuation, capTable?.currency_code)}
          </Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Currency</Text>
          <Text weight="plus" className="mt-1">{capTable?.currency_code ?? "—"}</Text>
        </div>
      </div>

      {/* Payments ledger */}
      <div className="flex flex-col gap-y-2 px-6 py-5">
        <Text weight="plus">Payments ledger</Text>
        {isPending ? (
          <div className="flex flex-col gap-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">No payments recorded yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Amount</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Method</Table.HeaderCell>
                <Table.HeaderCell>Reference</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {payments.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Cell>{money(p.amount, p.currency_code)}</Table.Cell>
                  <Table.Cell>{p.payment_type ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={paymentStatusColor(p.status)}>{p.status ?? "pending"}</Badge>
                  </Table.Cell>
                  <Table.Cell>{p.method ?? "—"}</Table.Cell>
                  <Table.Cell>{p.reference_number ?? "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}
