import { createDataTableColumnHelper } from "@medusajs/ui"
import { Container, Heading } from "@medusajs/ui"
import { useMemo } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { Filter } from "../../../components/table/data-table"
import { _DataTable } from "../../../components/table/data-table/data-table"
import {
  PartnerAssignedTask,
  usePartnerAssignedTasks,
} from "../../../hooks/api/partner-assigned-tasks"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"

const columnHelper = createDataTableColumnHelper<PartnerAssignedTask>()

const PAGE_SIZE = 20

export const TaskList = () => {
  const raw = useQueryParams(["offset", "q", "status", "priority", "order"])
  const offset = raw.offset ? Number(raw.offset) : 0
  const q = raw.q?.trim() || ""
  const statusFilter = raw.status?.trim() || ""
  const priorityFilter = raw.priority?.trim() || ""
  const order = raw.order?.trim() || ""

  const { tasks, isPending, isError, error } = usePartnerAssignedTasks()

  const filteredSorted = useMemo(() => {
    const text = q.toLowerCase()

    let data = (tasks || []).filter((task) => {
      const title = String(task.title || "").toLowerCase()
      const description = String(task.description || "").toLowerCase()
      const status = String(task.status || "").toLowerCase()
      const priority = String(task.priority || "").toLowerCase()

      if (statusFilter) {
        const s = statusFilter.toLowerCase()
        if (!status.includes(s)) {
          return false
        }
      }

      if (priorityFilter) {
        const p = priorityFilter.toLowerCase()
        if (!priority.includes(p)) {
          return false
        }
      }

      if (!text) {
        return true
      }

      return (
        title.includes(text) ||
        description.includes(text) ||
        status.includes(text) ||
        priority.includes(text)
      )
    })

    if (order) {
      const desc = order.startsWith("-")
      const key = (desc ? order.slice(1) : order) as keyof PartnerAssignedTask

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
  }, [order, priorityFilter, q, statusFilter, tasks])

  const pagedTasks = useMemo(() => {
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
        key: "priority",
        label: "Priority",
      },
    ],
    []
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: () => "Title",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
      columnHelper.accessor("status", {
        header: () => "Status",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
      columnHelper.accessor("priority", {
        header: () => "Priority",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
      columnHelper.accessor("updated_at", {
        header: () => "Updated",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
    ],
    []
  )

  const { table } = useDataTable({
    data: pagedTasks,
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
          <Heading>Tasks</Heading>
        </div>
        <_DataTable
          columns={columns}
          table={table}
          pagination
          navigateTo={(row) => `/tasks/${row.original.id}`}
          count={filteredSorted.length}
          isLoading={isPending}
          pageSize={PAGE_SIZE}
          filters={filters}
          orderBy={[
            { key: "title", label: "Title" },
            { key: "created_at", label: "Created" },
            { key: "updated_at", label: "Updated" },
          ]}
          search
          queryObject={raw}
          noRecords={{
            message: "No tasks",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}
