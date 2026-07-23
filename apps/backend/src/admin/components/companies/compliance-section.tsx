import {
  Badge,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { ArrowUpRightOnBox, DocumentText, PencilSquare } from "@medusajs/icons"
import { ActionMenu } from "../common/action-menu"
import {
  useCompanyDocuments,
  type AdminDocument,
} from "../../hooks/api/investor-financials-admin"

const statusColor = (s?: string): "green" | "orange" | "red" | "grey" => {
  switch (s) {
    case "Active":
      return "green"
    case "Pending":
      return "orange"
    case "Suspended":
    case "Inactive":
      return "red"
    default:
      return "grey"
  }
}

const DocumentsTable = ({ documents }: { documents: AdminDocument[] }) => {
  const table = useDataTable({
    data: documents,
    columns: [
      { header: "Title", accessorKey: "title" },
      {
        header: "Type",
        accessorKey: "document_type",
        cell: ({ row }: any) => <Badge>{row.original.document_type ?? "other"}</Badge>,
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
        cell: ({ row }: any) => (
          <div className="flex justify-end">
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      icon: <ArrowUpRightOnBox />,
                      label: row.original.file_url ? "Open file" : "No file",
                      disabled: !row.original.file_url,
                      onClick: () =>
                        row.original.file_url &&
                        window.open(row.original.file_url, "_blank", "noopener"),
                    },
                  ],
                },
              ]}
            />
          </div>
        ),
      },
    ],
  })
  return (
    <DataTable instance={table}>
      <DataTable.Table />
    </DataTable>
  )
}

export const ComplianceSection = ({
  companyId,
  company,
}: {
  companyId: string
  company: any
}) => {
  const { documents = [], isPending } = useCompanyDocuments(companyId)

  const fields: Array<[string, string]> = [
    ["Registration number", company?.registration_number || "—"],
    ["Tax ID", company?.tax_id || "—"],
    ["Country", company?.country || "—"],
    ["Industry", company?.industry || "—"],
  ]

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-3">
          <Heading level="h2">Compliance</Heading>
          {company?.status && <Badge color={statusColor(company.status)}>{company.status}</Badge>}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                { icon: <PencilSquare />, label: "Edit details", to: "edit-details" },
                { icon: <PencilSquare />, label: "Edit investor profile", to: "edit-investor-profile" },
                { icon: <DocumentText />, label: "Add document", to: "add-document" },
              ],
            },
          ]}
        />
      </div>

      {/* Reg / tax fields */}
      <div className="grid grid-cols-2 gap-4 px-6 py-5 md:grid-cols-4">
        {fields.map(([label, value]) => (
          <div key={label}>
            <Text size="small" className="text-ui-fg-subtle">{label}</Text>
            <Text weight="plus" className="mt-1 break-words">{value}</Text>
          </div>
        ))}
      </div>

      {/* Document vault (full width) */}
      <div>
        <div className="px-6 pb-3 pt-5">
          <Text weight="plus">Document vault</Text>
        </div>
        {isPending ? (
          <div className="flex flex-col gap-y-2 px-6 pb-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : documents.length === 0 ? (
          <div className="px-6 pb-5">
            <Text size="small" className="text-ui-fg-subtle">No documents yet.</Text>
          </div>
        ) : (
          <DocumentsTable documents={documents} />
        )}
      </div>
    </Container>
  )
}
