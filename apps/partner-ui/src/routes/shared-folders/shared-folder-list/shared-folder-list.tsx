import {
  Badge,
  Container,
  Heading,
  Text,
  createDataTableColumnHelper,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { _DataTable } from "../../../components/table/data-table/data-table"
import {
  usePartnerSharedFolders,
  type SharedFolder,
} from "../../../hooks/api/partner-shared-folders"
import { useDataTable } from "../../../hooks/use-data-table"

const columnHelper = createDataTableColumnHelper<SharedFolder>()

export const SharedFolderList = () => {
  const {
    shared_folders,
    isPending,
    isError,
    error,
  } = usePartnerSharedFolders({ placeholderData: keepPreviousData })

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Folder",
        cell: (ctx) => {
          const folder = ctx.row.original
          return (
            <div className="flex flex-col">
              <Text size="small" weight="plus">
                {folder.name}
              </Text>
              {folder.description && (
                <Text
                  size="xsmall"
                  className="text-ui-fg-muted truncate max-w-[300px]"
                >
                  {folder.description}
                </Text>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor("path", {
        header: "Path",
        cell: (ctx) => (
          <span className="font-mono text-xs text-ui-fg-subtle">
            {ctx.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("media_files", {
        header: "Files",
        cell: (ctx) => {
          const files = ctx.getValue() || []
          return (
            <Badge size="2xsmall" color="grey">
              {files.length}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("assigned_persons", {
        header: "Assigned To",
        cell: (ctx) => {
          const persons = ctx.getValue() || []
          if (!persons.length) return "—"
          return persons
            .map((p) => `${p.first_name} ${p.last_name}`)
            .join(", ")
        },
      }),
    ],
    []
  )

  const { table } = useDataTable({
    data: shared_folders,
    columns: columns as any,
    count: shared_folders.length,
    pageSize: 50,
    getRowId: (row) => row.id,
  })

  if (isError) {
    throw error
  }

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={true}>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Shared Folders</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Folders shared with you for uploading photos and documents
            </Text>
          </div>
        </div>
        <_DataTable
          table={table}
          columns={columns as any}
          count={shared_folders.length}
          pageSize={50}
          isLoading={isPending}
          navigateTo={(row) => `/shared-folders/${row.original.id}`}
          noRecords={{
            title: "No shared folders",
            message:
              "You don't have any shared folders yet. An admin will assign folders to you.",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}

export const Component = SharedFolderList
export const Breadcrumb = () => "Shared Folders"
