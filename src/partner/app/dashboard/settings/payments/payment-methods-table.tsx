"use client"

import { useMemo, useState, useTransition } from "react"
import { Button, DataTable, DataTablePaginationState, Input, Label, Select, Text, useDataTable } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { addPartnerPaymentMethod, PartnerPaymentMethod } from "../../actions"
import { useRouter } from "next/navigation"

function formatDate(iso?: string) {
  if (!iso) return "-"
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return "-"
  }
}

const buildColumns = (): ColumnDef<PartnerPaymentMethod>[] => [
  {
    id: "type",
    header: "Type",
    accessorKey: "type",
    cell: ({ row }) => {
      const t = row.original.type
      const label = t === "bank_account" ? "Bank Account" : t === "cash_account" ? "Cash Account" : "Digital Wallet"
      return label
    },
  },
  {
    id: "account_name",
    header: "Account Name",
    accessorKey: "account_name",
  },
  {
    id: "details",
    header: "Details",
    accessorFn: (row) => row.account_number || row.wallet_id || "",
    cell: ({ row }) => {
      const r = row.original
      if (r.type === "bank_account") {
        return (
          <div className="flex flex-col">
            <Text size="small" className="text-ui-fg-subtle">{r.bank_name || "Bank"}</Text>
            <Text size="small">{r.account_number || "—"}</Text>
            {r.ifsc_code ? (
              <Text size="xsmall" className="text-ui-fg-subtle">IFSC: {r.ifsc_code}</Text>
            ) : null}
          </div>
        )
      }
      if (r.type === "digital_wallet") {
        return <Text size="small">Wallet: {r.wallet_id || "—"}</Text>
      }
      return <Text size="small">—</Text>
    },
  },
  {
    id: "created_at",
    header: "Added",
    accessorKey: "created_at",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export default function PaymentMethodsTable({ data }: { data: PartnerPaymentMethod[] }) {
  const columns = useMemo(() => buildColumns(), [])
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 20 })
  const table = useDataTable<PartnerPaymentMethod>({
    columns,
    data,
    getRowId: (row) => row.id,
    rowCount: data.length,
    pagination: { state: pagination, onPaginationChange: setPagination },
  })

  // Add payment method form state
  const [type, setType] = useState<"bank_account" | "cash_account" | "digital_wallet">("bank_account")
  const [accountName, setAccountName] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [bankName, setBankName] = useState("")
  const [ifsc, setIfsc] = useState("")
  const [walletId, setWalletId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleAdd = (formData: FormData) => {
    setError(null)
    startTransition(async () => {
      try {
        await addPartnerPaymentMethod(formData)
        // reset fields
        setAccountName("")
        setAccountNumber("")
        setBankName("")
        setIfsc("")
        setWalletId("")
        router.refresh()
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to add payment method"
        setError(msg)
      }
    })
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="rounded-md border-2 border-dashed border-ui-border-base bg-ui-bg-base">
        <div className="px-6 py-4">
          <form action={handleAdd} className="grid grid-cols-1 lg:grid-cols-6 gap-3 items-end">
            <div className="flex flex-col gap-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "bank_account" | "cash_account" | "digital_wallet")} name="type">
                <Select.Trigger>
                  <Select.Value placeholder="Select type" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="bank_account">Bank Account</Select.Item>
                  <Select.Item value="cash_account">Cash Account</Select.Item>
                  <Select.Item value="digital_wallet">Digital Wallet</Select.Item>
                </Select.Content>
              </Select>
            </div>
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="account_name">Account Name</Label>
              <Input id="account_name" name="account_name" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Acme Pvt Ltd" />
            </div>
            {type === "bank_account" && (
              <>
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="account_number">Account Number</Label>
                  <Input id="account_number" name="account_number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="XXXXXXXXXX" />
                </div>
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="bank_name">Bank Name</Label>
                  <Input id="bank_name" name="bank_name" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="HDFC Bank" />
                </div>
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="ifsc_code">IFSC</Label>
                  <Input id="ifsc_code" name="ifsc_code" value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="HDFC0001234" />
                </div>
              </>
            )}
            {type === "digital_wallet" && (
              <div className="flex flex-col gap-y-1">
                <Label htmlFor="wallet_id">Wallet ID</Label>
                <Input id="wallet_id" name="wallet_id" value={walletId} onChange={(e) => setWalletId(e.target.value)} placeholder="UPI or Wallet ID" />
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" isLoading={isPending} disabled={isPending || !accountName}>
                Add Method
              </Button>
            </div>
          </form>
          {error ? <Text className="text-red-600 mt-2">{error}</Text> : null}
        </div>
      </div>

      <DataTable instance={table}>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </div>
  )
}
