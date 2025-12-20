import React from "react"
import { Text } from "@medusajs/ui"
import { DataTableRoot } from "../../table/data-table-root"
import { ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table"

export const PreviewTable: React.FC<{ data: any; title?: string }> = ({ data, title }) => {
    const rows = React.useMemo(() => {
        const candidates = [data, data?.items, data?.designs, data?.products, data?.data]
        const list = candidates.find((c) => Array.isArray(c)) as any[] | undefined
        if (!Array.isArray(list) || !list.length) return []
        return list
            .slice(0, 10)
            .map((r) => (r && typeof r === "object" && !Array.isArray(r) ? r : { value: r }))
    }, [data])

    const keys = React.useMemo(() => {
        const first = rows[0]
        if (!first || typeof first !== "object") return []
        return Object.keys(first).slice(0, 6)
    }, [rows])

    const columns = React.useMemo<ColumnDef<any, any>[]>(() => {
        if (!keys.length) return [{ accessorKey: "value", header: "value" }]
        return keys.map((k) => ({ accessorKey: k, header: k }))
    }, [keys])

    const table = useReactTable({
        data: rows,
        columns,
        getCoreRowModel: getCoreRowModel(),
    })

    if (!rows.length) return null

    return (
        <div className="mt-2">
            {title ? <Text className="text-ui-fg-subtle text-small mb-2">{title}</Text> : null}
            <div className="border border-ui-border-base rounded-md overflow-hidden">
                <DataTableRoot table={table} columns={columns} pagination={false} layout="fit" />
            </div>
        </div>
    )
}
