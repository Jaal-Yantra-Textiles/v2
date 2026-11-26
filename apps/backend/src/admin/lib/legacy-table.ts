/**
 * TanStack Table v8-shaped API for our own tables (Medusa 2.23 upgrade).
 *
 * Medusa 2.23 moved the admin to `@tanstack/react-table` v9. v9 removed
 * `useReactTable` and the `get*RowModel()` factories from the package root and
 * gave every type a leading `TFeatures` parameter. Our copies of the dashboard's
 * DataTable (`hooks/usedataTable.tsx`, `components/table/*`) and DataGrid
 * (`components/data-grid/*`) were written against v8, so `useReactTable` was
 * `undefined` at runtime after the bump.
 *
 * v9 ships a compatibility layer for exactly this, `@tanstack/react-table/legacy`.
 * This file re-exports it under the v8 names so those components keep their
 * shape. Columns that feed `@medusajs/ui`'s `DataTable` must NOT use this file:
 * they use `createDataTableColumnHelper` from `@medusajs/ui`.
 *
 * Column pinning in v9 is `"start"` / `"end"`, not `"left"` / `"right"`.
 */
import type {
  CellContext as CoreCellContext,
  ColumnDefTemplate,
  ColumnMeta as CoreColumnMeta,
  ColumnVisibilityState,
  HeaderContext as CoreHeaderContext,
  OnChangeFn,
  PaginationState,
  RowData,
  RowSelectionState,
} from "@tanstack/react-table"
import type {
  LegacyCell,
  LegacyColumn,
  LegacyColumnDef,
  LegacyFeatures,
  LegacyHeader,
  LegacyHeaderGroup,
  LegacyReactTable,
  LegacyRow,
  LegacyTable,
} from "@tanstack/react-table/legacy"

export {
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  legacyCreateColumnHelper as createColumnHelper,
  useLegacyTable as useReactTable,
} from "@tanstack/react-table/legacy"
export { flexRender } from "@tanstack/react-table"

export type {
  ColumnDefTemplate,
  OnChangeFn,
  PaginationState,
  RowData,
  RowSelectionState,
}

export type VisibilityState = ColumnVisibilityState
export type ColumnDef<TData extends RowData, TValue = unknown> = LegacyColumnDef<
  TData,
  TValue
>
export type Row<TData extends RowData> = LegacyRow<TData>
export type Table<TData extends RowData> = LegacyTable<TData>
export type ReactTable<TData extends RowData> = LegacyReactTable<TData>
export type Column<TData extends RowData, TValue = unknown> = LegacyColumn<
  TData,
  TValue
>
export type Cell<TData extends RowData, TValue = unknown> = LegacyCell<
  TData,
  TValue
>
export type Header<TData extends RowData, TValue = unknown> = LegacyHeader<
  TData,
  TValue
>
export type HeaderGroup<TData extends RowData> = LegacyHeaderGroup<TData>
export type CellContext<TData extends RowData, TValue = unknown> = CoreCellContext<
  LegacyFeatures,
  TData,
  TValue
>
export type HeaderContext<
  TData extends RowData,
  TValue = unknown,
> = CoreHeaderContext<LegacyFeatures, TData, TValue>
export type ColumnMeta<TData extends RowData, TValue = unknown> = CoreColumnMeta<
  LegacyFeatures,
  TData,
  TValue
>
