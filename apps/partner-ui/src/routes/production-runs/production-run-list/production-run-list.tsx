import { Container, Heading, Text, createDataTableColumnHelper } from "@medusajs/ui"
import { useMemo } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { Filter } from "../../../components/table/data-table"
import { _DataTable } from "../../../components/table/data-table/data-table"
import {
  PartnerProductionRun,
  usePartnerProductionRuns,
} from "../../../hooks/api/partner-production-runs"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"

const columnHelper = createDataTableColumnHelper<PartnerProductionRun>()

const PAGE_SIZE = 20

export const ProductionRunList = () => {
  const raw = useQueryParams(["offset", "q", "status", "role", "order"])
  const offset = raw.offset ? Number(raw.offset) : 0
  const q = raw.q?.trim() || ""
  const statusFilter = raw.status?.trim() || ""
  const roleFilter = raw.role?.trim() || ""
  const order = raw.order?.trim() || ""

  const { production_runs, isPending, isError, error } = usePartnerProductionRuns(
    {
      limit: PAGE_SIZE,
      offset,
      status: statusFilter || undefined,
      role: roleFilter || undefined,
    },
    {
      staleTime: 30000,
    }
  )

  const filteredSorted = useMemo(() => {
    const text = q.toLowerCase()

    let data = (production_runs || []).filter((run) => {
      const id = String(run.id || "").toLowerCase()
      const status = String(run.status || "").toLowerCase()
      const role = String(run.role || "").toLowerCase()

      if (statusFilter) {
        const s = statusFilter.toLowerCase()
        if (!status.includes(s)) {
          return false
        }
      }

      if (roleFilter) {
        const r = roleFilter.toLowerCase()
        if (!role.includes(r)) {
          return false
        }
      }

      if (!text) {
        return true
      }

      return id.includes(text) || status.includes(text) || role.includes(text)
    })

    if (order) {
      const desc = order.startsWith("-")
      const key = (desc ? order.slice(1) : order) as keyof PartnerProductionRun

      data = [...data].sort((a, b) => {
        const av = (a as any)?.[key]
        const bv = (b as any)?.[key]

        if (av == null && bv == null) {
          return 0
        }
        if (av == null) {
          return desc ? 1 : -1
        }
        if (bv == null) {
          return desc ? -1 : 1
        }

        const aStr = String(av)
        const bStr = String(bv)
        const cmp = aStr.localeCompare(bStr)
        return desc ? -cmp : cmp
      })
    }

    return data
  }, [order, production_runs, q, roleFilter, statusFilter])

  const paged = useMemo(() => {
    return filteredSorted.slice(offset, offset + PAGE_SIZE)
  }, [filteredSorted, offset])

  const filters = useMemo<Filter[]>(
    () => [
      {
        type: "string",
        key: "status",
        label: "Status",
      },
      {
        type: "string",
        key: "role",
        label: "Role",
      },
    ],
    []
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: () => "Run",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v) : "-"
        },
      }),
      columnHelper.accessor("status", {
        header: () => "Status",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v) : "-"
        },
      }),
      columnHelper.accessor("role", {
        header: () => "Role",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v) : "-"
        },
      }),
      columnHelper.accessor("quantity", {
        header: () => "Qty",
        cell: ({ getValue }) => {
          const v = getValue()
          return v != null ? String(v) : "-"
        },
      }),
      columnHelper.accessor("updated_at", {
        header: () => "Updated",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v) : "-"
        },
      }),
    ],
    []
  )

  const { table } = useDataTable({
    data: paged,
    columns,
    enablePagination: true,
    count: filteredSorted.length,
    pageSize: PAGE_SIZE,
  })

  if (isError) {
    throw error
  }

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Production Runs</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Runs assigned to you
            </Text>
          </div>
        </div>
        <_DataTable
          columns={columns}
          table={table}
          pagination
          navigateTo={(row) => `/production-runs/${row.original.id}`}
          count={filteredSorted.length}
          isLoading={isPending}
          pageSize={PAGE_SIZE}
          filters={filters}
          orderBy={[
            { key: "id", label: "Run" },
            { key: "created_at", label: "Created" },
            { key: "updated_at", label: "Updated" },
          ]}
          search
          queryObject={raw}
          noRecords={{
            message: "No production runs",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}
