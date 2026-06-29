import { Button, Checkbox, Text, toast } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import {
  OnChangeFn,
  RowSelectionState,
  createColumnHelper,
} from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { _DataTable } from "../../../../../components/table/data-table"
import { ThumbnailPreview } from "../../../../../components/common/thumbnail/thumbnail-preview"
import { RouteFocusModal, useRouteModal } from "../../../../../components/modals"
import { useDataTable } from "../../../../../hooks/use-data-table"
import {
  PartnerRawMaterialRow,
  useLinkPartnerDesignInventory,
  usePartnerRawMaterials,
} from "../../../../../hooks/api/partner-design-inventory"

const PAGE_SIZE = 20

type Props = { designId: string }

export const AddInventoryForm = ({ designId }: Props) => {
  const { handleSuccess } = useRouteModal()
  const [searchParams] = useSearchParams()
  const q = searchParams.get("q") || ""
  const offset = searchParams.get("offset") ? Number(searchParams.get("offset")) : 0

  const { raw_materials, count, isPending } = usePartnerRawMaterials(
    { q: q || undefined, limit: PAGE_SIZE, offset },
    { placeholderData: keepPreviousData }
  )

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const updater: OnChangeFn<RowSelectionState> = (fn) => {
    setRowSelection(typeof fn === "function" ? fn(rowSelection) : fn)
  }

  const columns = useColumns()

  const { table } = useDataTable({
    data: raw_materials,
    columns,
    count,
    pageSize: PAGE_SIZE,
    enableRowSelection: true,
    getRowId: (row) => row.id,
    rowSelection: { state: rowSelection, updater },
  })

  const { mutateAsync, isPending: isSaving } =
    useLinkPartnerDesignInventory(designId)

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k])

  const handleAdd = async () => {
    if (!selectedIds.length) {
      toast.error("Select at least one material")
      return
    }
    await mutateAsync(
      {
        inventoryItems: selectedIds.map((inventoryId) => ({ inventoryId })),
      },
      {
        onSuccess: () => {
          toast.success(
            `Added ${selectedIds.length} material${selectedIds.length > 1 ? "s" : ""}`
          )
          handleSuccess()
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-2">
          <Text size="small" className="text-ui-fg-subtle">
            {selectedIds.length > 0
              ? `${selectedIds.length} selected`
              : "Select materials to add"}
          </Text>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex size-full flex-col overflow-hidden">
        <_DataTable
          table={table}
          columns={columns}
          count={count}
          pageSize={PAGE_SIZE}
          isLoading={isPending}
          search="autofocus"
          pagination
          layout="fill"
          queryObject={{ q, offset }}
          commands={[
            {
              label: "Add to design",
              shortcut: "a",
              action: async () => {
                await handleAdd()
              },
            },
          ]}
          noRecords={{
            title: "No raw materials",
            message:
              "No raw materials found. Admin maintains the shared raw-material catalog.",
          }}
        />
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            onClick={handleAdd}
            isLoading={isSaving}
            disabled={!selectedIds.length}
          >
            Add{selectedIds.length ? ` (${selectedIds.length})` : ""}
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

const columnHelper = createColumnHelper<PartnerRawMaterialRow>()

const useColumns = () =>
  useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      }),
      columnHelper.display({
        id: "material",
        header: () => "Material",
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex items-center gap-x-3 overflow-hidden">
              <ThumbnailPreview src={r.media_url ?? undefined} alt={r.raw_material_name ?? ""} />
              <div className="flex flex-col overflow-hidden">
                <span className="truncate font-medium">
                  {r.raw_material_name || r.title || r.id}
                </span>
                {r.sku && (
                  <span className="text-ui-fg-subtle truncate text-xs">
                    SKU: {r.sku}
                  </span>
                )}
              </div>
            </div>
          )
        },
      }),
      columnHelper.accessor("composition", {
        header: () => "Composition",
        cell: ({ getValue }) => (
          <span className="text-ui-fg-subtle truncate">{getValue() || "-"}</span>
        ),
      }),
      columnHelper.accessor("color", {
        header: () => "Color",
        cell: ({ getValue }) => (
          <span className="text-ui-fg-subtle">{getValue() || "-"}</span>
        ),
      }),
      columnHelper.accessor("unit_of_measure", {
        header: () => "Unit",
        cell: ({ getValue }) => (
          <span className="text-ui-fg-subtle">{getValue() || "-"}</span>
        ),
      }),
    ],
    []
  )
