import {
  Badge,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { ArrowDownTray } from "@medusajs/icons"
import { ActionMenu } from "../../components/common/action-menu/action-menu"
import {
  useMyDocuments,
  type InvestorDocument,
} from "../../hooks/api/investments"

const prettyType = (t?: string) =>
  (t ?? "other").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

const useDocumentColumns = () => [
  { header: "Title", accessorKey: "title" },
  {
    header: "Type",
    accessorKey: "document_type",
    cell: ({ row }: any) => <Badge>{prettyType(row.original.document_type)}</Badge>,
  },
  {
    header: "Visibility",
    accessorKey: "visibility",
    cell: ({ row }: any) => (
      <Badge color={row.original.visibility === "public" ? "green" : "grey"}>
        {row.original.visibility ?? "investor"}
      </Badge>
    ),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }: any) => {
      const url = row.original.file_url as string | undefined
      return (
        <div className="flex justify-end">
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    icon: <ArrowDownTray />,
                    label: url ? "Open / download" : "No file",
                    disabled: !url,
                    onClick: () => url && window.open(url, "_blank", "noopener"),
                  },
                ],
              },
            ]}
          />
        </div>
      )
    },
  },
]

export const Component = () => {
  const { documents, isPending } = useMyDocuments()

  const table = useDataTable({
    data: documents,
    columns: useDocumentColumns(),
  })

  return (
    <div className="flex flex-col gap-y-3">
      <div>
        <Heading level="h1">Compliance</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          KYC, agreements and legal documents shared with you
        </Text>
      </div>

      {isPending ? (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Documents</Heading>
          </div>
          <div className="flex flex-col gap-y-2 px-6 py-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Container>
      ) : documents.length === 0 ? (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Documents</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              KYC, agreements and legal documents shared with you.
            </Text>
          </div>
          <div className="px-6 py-5">
            <Text size="small" className="text-ui-fg-subtle">
              No documents shared with you yet.
            </Text>
          </div>
        </Container>
      ) : (
        <Container className="divide-y p-0">
          <DataTable instance={table}>
            <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
              <div>
                <Heading level="h2">Documents</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  KYC, agreements and legal documents shared with you.
                </Text>
              </div>
            </DataTable.Toolbar>
            <DataTable.Table />
          </DataTable>
        </Container>
      )}
    </div>
  )
}
