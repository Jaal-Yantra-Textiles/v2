import {
  Badge,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { CurrencyDollar } from "@medusajs/icons"
import { useMemo } from "react"
import { ActionMenu } from "../common/action-menu"
import { useCompanyCapTables } from "../../hooks/api/cap-tables-admin"
import {
  useCompanyPayments,
  type AdminPayment,
} from "../../hooks/api/investor-financials-admin"

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

const PaymentsLedgerTable = ({
  payments,
  currency,
}: {
  payments: AdminPayment[]
  currency?: string | null
}) => {
  const table = useDataTable({
    data: payments,
    columns: [
      {
        header: "Amount",
        accessorKey: "amount",
        cell: ({ row }: any) => money(row.original.amount, row.original.currency_code ?? currency),
      },
      {
        header: "Type",
        accessorKey: "payment_type",
        cell: ({ row }: any) => row.original.payment_type ?? "—",
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: any) => (
          <Badge color={paymentStatusColor(row.original.status)}>
            {row.original.status ?? "pending"}
          </Badge>
        ),
      },
      {
        header: "Method",
        accessorKey: "method",
        cell: ({ row }: any) => row.original.method ?? "—",
      },
      {
        header: "Reference",
        accessorKey: "reference_number",
        cell: ({ row }: any) => row.original.reference_number ?? "—",
      },
    ],
  })
  return (
    <DataTable instance={table}>
      <DataTable.Table />
    </DataTable>
  )
}

export const FinancialsSection = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { payments = [], isPending } = useCompanyPayments(companyId)
  const ccy = capTable?.currency_code

  // Rollups derived from the ledger — refresh the instant a payment is recorded.
  const { totalCollected, totalPending } = useMemo(() => {
    const collected = payments
      .filter((p) => p.status === "completed")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const pending = payments
      .filter((p) => p.status === "pending" || p.status === "in_progress")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)
    return { totalCollected: collected, totalPending: pending }
  }, [payments])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Financials</Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                { icon: <CurrencyDollar />, label: "Record payment", to: "record-payment" },
              ],
            },
          ]}
        />
      </div>

      {/* Summary — valuations from the cap table + live rollups from the ledger */}
      <div className="grid grid-cols-2 gap-4 px-6 py-5 md:grid-cols-4">
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Collected</Text>
          <Text weight="plus" className="mt-1">{money(totalCollected, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Pending</Text>
          <Text weight="plus" className="mt-1">{money(totalPending, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Pre-money</Text>
          <Text weight="plus" className="mt-1">{money(capTable?.pre_money_valuation, ccy)}</Text>
        </div>
        <div className="rounded-lg border p-3">
          <Text size="small" className="text-ui-fg-subtle">Post-money</Text>
          <Text weight="plus" className="mt-1">{money(capTable?.post_money_valuation, ccy)}</Text>
        </div>
      </div>

      {/* Payments ledger (full width) */}
      <div>
        <div className="px-6 pb-3 pt-5">
          <Text weight="plus">Payments ledger</Text>
        </div>
        {isPending ? (
          <div className="flex flex-col gap-y-2 px-6 pb-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <div className="px-6 pb-5">
            <Text size="small" className="text-ui-fg-subtle">No payments recorded yet.</Text>
          </div>
        ) : (
          <PaymentsLedgerTable payments={payments} currency={ccy} />
        )}
      </div>
    </Container>
  )
}
