import { createDataTableColumnHelper } from "@medusajs/ui"
import { Container, Heading } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { Filter } from "../../../components/table/data-table"
import { _DataTable } from "../../../components/table/data-table/data-table"
import {
  PartnerInventoryOrder,
  usePartnerInventoryOrders,
} from "../../../hooks/api/partner-inventory-orders"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"

const columnHelper = createDataTableColumnHelper<PartnerInventoryOrder>()

const PAGE_SIZE = 20

export const InventoryOrdersList = () => {
  const raw = useQueryParams(["offset", "q", "status", "partner_status", "order"])
  const offset = raw.offset ? Number(raw.offset) : 0
  const q = raw.q?.trim() || ""
  const statusFilter = raw.status?.trim() || ""
  const partnerStatusFilter = raw.partner_status?.trim() || ""
  const order = raw.order?.trim() || ""

  const { inventory_orders, count = 0, isPending, isError, error } =
    usePartnerInventoryOrders(
      {
        limit: PAGE_SIZE,
        offset,
        status: statusFilter || undefined,
      },
      {
        placeholderData: keepPreviousData,
      }
    )

  const filteredData = useMemo(() => {
    const text = q.toLowerCase()
    let data = (inventory_orders || []).filter((row) => {
      const id = String(row.id || "").toLowerCase()
      const status = String(row.status || "").toLowerCase()
      const partnerStatus = String(row?.partner_info?.partner_status || "").toLowerCase()

      if (partnerStatusFilter) {
        const p = partnerStatusFilter.toLowerCase()
        if (!partnerStatus.includes(p)) {
          return false
        }
      }

      if (statusFilter) {
        const s = statusFilter.toLowerCase()
        if (!status.includes(s)) {
          return false
        }
      }

      if (!text) {
        return true
      }

      return id.includes(text) || status.includes(text) || partnerStatus.includes(text)
    })

    if (order) {
      const desc = order.startsWith("-")
      const key = (desc ? order.slice(1) : order) as keyof PartnerInventoryOrder

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
  }, [inventory_orders, order, partnerStatusFilter, q, statusFilter])

  const filters = useMemo<Filter[]>(
    () => [
      {
        type: "string",
        key: "status",
        label: "Status",
      },
      {
        type: "string",
        key: "partner_status",
        label: "Partner Status",
      },
    ],
    []
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: () => "ID",
        cell: ({ getValue }) => String(getValue()),
      }),
      columnHelper.accessor((row) => row?.partner_info?.partner_status, {
        id: "partner_status",
        header: () => "Partner Status",
        cell: ({ getValue }) => (getValue() ? String(getValue()) : "-"),
      }),
      columnHelper.accessor("status", {
        header: () => "Status",
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
    data: filteredData,
    columns,
    enablePagination: true,
    count,
    pageSize: PAGE_SIZE,
  })

  if (isError) {
    throw error
  }

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading>Inventory Orders</Heading>
        </div>
        <_DataTable
          columns={columns}
          table={table}
          pagination
          navigateTo={(row) => `/inventory-orders/${row.original.id}`}
          count={count}
          isLoading={isPending}
          pageSize={PAGE_SIZE}
          filters={filters}
          orderBy={[
            { key: "id", label: "ID" },
            { key: "created_at", label: "Created" },
            { key: "updated_at", label: "Updated" },
          ]}
          search
          queryObject={raw}
          noRecords={{
            message: "No inventory orders",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}
