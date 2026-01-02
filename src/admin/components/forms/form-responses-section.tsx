import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  DataTablePaginationState,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { createColumnHelper } from "@tanstack/react-table"
import { Eye } from "@medusajs/icons"
import { EntityActions } from "../persons/personsActions"
import { AdminFormResponse, useFormResponses } from "../../hooks/api/forms"
import { useFormResponsesTableColumns } from "../../hooks/columns/useFormResponsesTableColumns"

type FormResponsesSectionProps = {
  formId: string
}

const columnHelper = createColumnHelper<AdminFormResponse>()

export const FormResponsesSection = ({ formId }: FormResponsesSectionProps) => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  })

  const offset = pagination.pageIndex * pagination.pageSize

  const { responses, count, isLoading } = useFormResponses(
    formId,
    {
      limit: pagination.pageSize,
      offset,
    },
    {
      placeholderData: keepPreviousData,
    }
  )

  const columnsBase = useFormResponsesTableColumns()

  const responseActionsConfig = useMemo(
    () => ({
      actions: [
        {
          icon: <Eye />,
          label: "View",
          to: (resp: AdminFormResponse) =>
            `/settings/forms/${formId}/responses/${resp.id}`,
        },
      ],
    }),
    [formId]
  )

  const columns = useMemo(
    () => [
      ...columnsBase,
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <EntityActions
            entity={row.original}
            actionsConfig={responseActionsConfig}
          />
        ),
      }),
    ],
    [columnsBase, responseActionsConfig]
  )

  const table = useDataTable({
    columns,
    data: responses ?? [],
    getRowId: (row) => row.id as string,
    rowCount: count,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Responses</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Latest submissions for this form
          </Text>
        </div>
      </div>
      <DataTable instance={table}>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
