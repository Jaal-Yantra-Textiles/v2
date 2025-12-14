import { Button, Container, Heading, Text, createDataTableColumnHelper } from "@medusajs/ui"
import { useMemo } from "react"
import { Link } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { _DataTable } from "../../../components/table/data-table"
import { useMe } from "../../../hooks/api/users"
import { useDataTable } from "../../../hooks/use-data-table"

export const SettingsPeople = () => {
  const { user, isPending, isError, error } = useMe()

  if (isError) {
    throw error
  }

  const partner = user?.partner
  const partnerId = user?.partner_id

  type PersonRow = {
    id: string
    first_name?: string | null
    last_name?: string | null
    email?: string | null
    role?: string | null
    created_at?: string | null
  }

  const admins = useMemo<PersonRow[]>(() => {
    const list = Array.isArray(partner?.admins) ? partner?.admins.filter(Boolean) : []
    return list.map((a: any) => ({
      id: String(a.id),
      first_name: a.first_name ?? null,
      last_name: a.last_name ?? null,
      email: a.email ?? null,
      role: a.role ?? null,
      created_at: a.created_at ?? null,
    }))
  }, [partner?.admins])

  const localPeople = useMemo<PersonRow[]>(() => {
    if (!partnerId) {
      return []
    }

    if (typeof window === "undefined") {
      return []
    }

    try {
      const raw = localStorage.getItem(`partner_people_${partnerId}`)
      const parsed = raw ? (JSON.parse(raw) as any[]) : []
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed.map((p) => ({
        id: String(p.id),
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        email: p.email ?? null,
        role: p.role ?? null,
        created_at: p.created_at ?? null,
      }))
    } catch {
      return []
    }
  }, [partnerId])

  const rows = useMemo(() => {
    const combined = [...localPeople, ...admins]

    // de-dupe by email if possible
    const seen = new Set<string>()
    return combined.filter((p) => {
      const key = String(p.email || p.id)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }, [admins, localPeople])

  const columnHelper = useMemo(() => createDataTableColumnHelper<PersonRow>(), [])

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => {
        const name = [row.first_name, row.last_name].filter(Boolean).join(" ")
        return name || row.email || "-"
      }, {
        id: "name",
        header: () => "Name",
        cell: ({ getValue, row }) => {
          const name = String(getValue() || "-")
          const role = row.original.role || "Member"
          return (
            <div className="flex flex-col">
              <Text size="small" weight="plus">
                {name}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {String(role)}
              </Text>
            </div>
          )
        },
      }),
      columnHelper.accessor("email", {
        header: () => "Email",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
      columnHelper.accessor("created_at", {
        header: () => "Added",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
    ],
    [columnHelper]
  )

  const { table } = useDataTable({
    data: rows,
    columns,
    enablePagination: true,
    count: rows.length,
    pageSize: 20,
  })

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>People</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Manage your team members
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
          isLoading={isPending}
          pageSize={20}
          queryObject={{}}
          noRecords={{
            message: "No people",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}
