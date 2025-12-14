import {
  Button,
  Container,
  Heading,
  Text,
  createDataTableColumnHelper,
} from "@medusajs/ui"
import { useMemo } from "react"
import { Link } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { _DataTable } from "../../../components/table/data-table"
import { getLocaleAmount } from "../../../lib/money-amount-helpers"
import { usePartnerPayments } from "../../../hooks/api/partner-payments"
import { useMe } from "../../../hooks/api/users"
import { useDataTable } from "../../../hooks/use-data-table"

export const SettingsPayments = () => {
  const { user } = useMe()
  const partnerId = user?.partner_id

  const { payments, isPending: isPaymentsLoading } = usePartnerPayments(partnerId)

  type PaymentMethodRow = {
    id: string
    type: string
    account_name: string
    account_number?: string | null
    bank_name?: string | null
    ifsc_code?: string | null
    wallet_id?: string | null
    created_at?: string | null
  }

  const rows = useMemo<PaymentMethodRow[]>(() => {
    if (!partnerId) {
      return []
    }

    if (typeof window === "undefined") {
      return []
    }

    try {
      const raw = localStorage.getItem(`partner_payment_methods_${partnerId}`)
      const parsed = raw ? (JSON.parse(raw) as any[]) : []
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed.map((m) => ({
        id: String(m.id),
        type: String(m.type || ""),
        account_name: String(m.account_name || ""),
        account_number: m.account_number ?? null,
        bank_name: m.bank_name ?? null,
        ifsc_code: m.ifsc_code ?? null,
        wallet_id: m.wallet_id ?? null,
        created_at: m.created_at ?? null,
      }))
    } catch {
      return []
    }
  }, [partnerId])

  type PaymentRow = {
    id: string
    amount?: number | null
    currency_code?: string | null
    created_at?: string | null
  }

  const paymentRows = useMemo<PaymentRow[]>(() => {
    return (payments || []).map((p) => ({
      id: String(p.id),
      amount: typeof p.amount === "number" ? p.amount : null,
      currency_code: p.currency_code ?? null,
      created_at: p.created_at ?? null,
    }))
  }, [payments])

  const columnHelper = useMemo(() => createDataTableColumnHelper<PaymentMethodRow>(), [])
  const paymentsColumnHelper = useMemo(
    () => createDataTableColumnHelper<PaymentRow>(),
    []
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("type", {
        header: () => "Type",
        cell: ({ getValue }) => {
          const v = String(getValue() || "-")
          if (v === "bank_account") return "Bank Account"
          if (v === "cash_account") return "Cash Account"
          if (v === "digital_wallet") return "Digital Wallet"
          return v || "-"
        },
      }),
      columnHelper.accessor("account_name", {
        header: () => "Account Name",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
      columnHelper.accessor((row) => {
        return row.account_number || row.wallet_id || ""
      }, {
        id: "details",
        header: () => "Details",
        cell: ({ row }) => {
          const r = row.original
          if (r.type === "bank_account") {
            return (
              <div className="flex flex-col">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {r.bank_name || "Bank"}
                </Text>
                <Text size="small">{r.account_number || "-"}</Text>
                {r.ifsc_code ? (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    IFSC: {r.ifsc_code}
                  </Text>
                ) : null}
              </div>
            )
          }

          if (r.type === "digital_wallet") {
            return <Text size="small">Wallet: {r.wallet_id || "-"}</Text>
          }

          return <Text size="small">-</Text>
        },
      }),
      columnHelper.accessor("created_at", {
        header: () => "Added",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
    ],
    [columnHelper]
  )

  const paymentsColumns = useMemo(
    () => [
      paymentsColumnHelper.accessor("id", {
        header: () => "Payment ID",
        cell: ({ row }) => {
          const id = row.original.id
          const createdAt = row.original.created_at
          const date = (() => {
            if (!createdAt) {
              return "-"
            }
            try {
              return new Date(String(createdAt)).toISOString().slice(0, 10)
            } catch {
              return "-"
            }
          })()

          return (
            <div className="flex flex-col">
              <Text weight="plus">{id}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {date}
              </Text>
            </div>
          )
        },
      }),
      paymentsColumnHelper.accessor("amount", {
        header: () => "Amount",
        cell: ({ row }) => {
          const amount = row.original.amount
          const currency = (row.original.currency_code || "USD").toUpperCase()
          if (typeof amount !== "number") {
            return "—"
          }
          try {
            return getLocaleAmount(amount, currency)
          } catch {
            return `${amount} ${currency}`.trim()
          }
        },
      }),
      paymentsColumnHelper.accessor("currency_code", {
        header: () => "Currency",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v).toUpperCase() : "—"
        },
      }),
    ],
    [paymentsColumnHelper]
  )

  const { table } = useDataTable({
    data: rows,
    columns,
    enablePagination: true,
    count: rows.length,
    pageSize: 20,
  })

  const { table: paymentsTable } = useDataTable({
    data: paymentRows,
    columns: paymentsColumns,
    enablePagination: true,
    count: paymentRows.length,
    pageSize: 20,
  })

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <div className="flex flex-col gap-y-3">
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading>Payments</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Payment methods
              </Text>
            </div>
            <Button size="small" variant="secondary" asChild disabled={!partnerId}>
              <Link to="create">Create</Link>
            </Button>
          </div>

          <_DataTable
            columns={columns}
            table={table}
            pagination
            count={rows.length}
            isLoading={false}
            pageSize={20}
            queryObject={{}}
            noRecords={{
              message: "No payment methods",
            }}
          />
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Recent payments</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              View recent payments.
            </Text>
          </div>

          <_DataTable
            columns={paymentsColumns}
            table={paymentsTable}
            pagination
            count={paymentRows.length}
            isLoading={isPaymentsLoading}
            pageSize={20}
            queryObject={{}}
            noRecords={{
              message: "No payments",
            }}
          />
        </Container>
      </div>
    </SingleColumnPage>
  )
}
