import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  DataTablePaginationState,
  toast,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { createColumnHelper } from "@tanstack/react-table"
import { Eye, SquareTwoStack } from "@medusajs/icons"
import { EntityActions } from "../persons/personsActions"
import { AdminFormResponse, useFormResponses } from "../../hooks/api/forms"
import { useFormResponsesTableColumns } from "../../hooks/columns/useFormResponsesTableColumns"

const TOUR_WEBSITE_ORIGIN: string =
  (process.env.NEXT_PUBLIC_WEBSITE_URL?.replace(/\/$/, "") as string | undefined) ||
  "https://jaalyantra.com"

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

  const buildActionsConfig = (resp: AdminFormResponse) => {
    const actions: any[] = [
      {
        icon: <Eye />,
        label: "View",
        to: (r: AdminFormResponse) =>
          `/settings/forms/${formId}/responses/${r.id}`,
      },
    ]
    if ((resp as any)?.verification_code) {
      actions.push({
        icon: <SquareTwoStack />,
        label: "Copy visit link",
        onClick: async (r: AdminFormResponse) => {
          const code = (r as any)?.verification_code
          const url = `${TOUR_WEBSITE_ORIGIN}/tours/visit/${code}`
          try {
            await navigator.clipboard.writeText(url)
            toast.success("Visit link copied")
          } catch {
            toast.error("Could not copy — check clipboard permissions")
          }
        },
      })
    }
    return { actions }
  }

  const columns = useMemo(
    () => [
      ...columnsBase,
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <EntityActions
            entity={row.original}
            actionsConfig={buildActionsConfig(row.original)}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnsBase, formId]
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
