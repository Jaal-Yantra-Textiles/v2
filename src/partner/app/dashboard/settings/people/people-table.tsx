"use client"

import { useMemo, useState, useTransition } from "react"
import { DataTable, Text, useDataTable, DataTablePaginationState, Button, Input, Label } from "@medusajs/ui"
import { ColumnDef } from "@tanstack/react-table"
import { addPartnerPerson, PartnerPerson } from "../../actions"
import { useRouter } from "next/navigation"

function formatDate(iso?: string) {
  if (!iso) return "-"
  try {
    const d = new Date(iso)
    return d.toISOString().slice(0, 10)
  } catch {
    return "-"
  }
}

const buildColumns = (): ColumnDef<PartnerPerson>[] => [
  {
    id: "name",
    header: "Name",
    accessorFn: (row) => `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Text weight="plus">{`${row.original.first_name || ""} ${row.original.last_name || ""}`.trim() || "—"}</Text>
        <Text size="xsmall" className="text-ui-fg-subtle">{row.original.role || "Member"}</Text>
      </div>
    ),
  },
  {
    id: "email",
    header: "Email",
    accessorKey: "email",
    cell: ({ row }) => row.original.email || "—",
  },
  {
    id: "phone",
    header: "Phone",
    accessorKey: "phone",
    cell: ({ row }) => row.original.phone || "—",
  },
  {
    id: "created_at",
    header: "Added",
    accessorKey: "created_at",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export default function PeopleTable({ data }: { data: PartnerPerson[] }) {
  const router = useRouter()
  const columns = useMemo(() => buildColumns(), [])
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: 20 })
  const table = useDataTable<PartnerPerson>({
    columns,
    data,
    getRowId: (row) => row.id,
    rowCount: data.length,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  // Add person form state
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleAdd = (formData: FormData) => {
    setError(null)
    startTransition(async () => {
      try {
        await addPartnerPerson(formData)
        setFirstName("")
        setLastName("")
        setEmail("")
        // Refresh the page to re-fetch server data
        router.refresh()
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to add person"
        setError(msg)
      }
    })
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="rounded-md border-2 border-dashed border-ui-border-base bg-ui-bg-base">
        <div className="px-6 py-4">
        <form action={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="first_name">First name</Label>
            <Input id="first_name" name="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="last_name">Last name</Label>
            <Input id="last_name" name="last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" type="email" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" isLoading={isPending} disabled={isPending || !email}>
              Add Person
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
