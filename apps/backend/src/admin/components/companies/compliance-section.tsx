import {
  Badge,
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import {
  useAddDocument,
  useCompanyDocuments,
  useUpdateCompanyCompliance,
} from "../../hooks/api/investor-financials-admin"
import { useFileUpload } from "../../hooks/api/upload"

const DOCUMENT_TYPES = [
  "kyc",
  "sha",
  "term_sheet",
  "subscription_agreement",
  "share_certificate",
  "financial_statement",
  "pitch_deck",
  "legal",
  "other",
] as const

const COMPANY_STATUSES = ["Active", "Inactive", "Pending", "Suspended"] as const

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

// ---- Edit compliance fields ------------------------------------------------

const EditComplianceModal = ({
  companyId,
  company,
}: {
  companyId: string
  company: any
}) => {
  const [open, setOpen] = useState(false)
  const form = useForm({
    defaultValues: {
      registration_number: company?.registration_number ?? "",
      tax_id: company?.tax_id ?? "",
      status: company?.status ?? "Active",
      industry: company?.industry ?? "",
    },
  })
  const { mutateAsync, isPending } = useUpdateCompanyCompliance(companyId, {
    onSuccess: () => {
      toast.success("Compliance details updated")
      setOpen(false)
    },
    onError: (e) => toast.error(e?.message || "Failed to update"),
  })
  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      registration_number: v.registration_number || null,
      tax_id: v.tax_id || null,
      status: v.status as any,
      industry: v.industry || null,
    })
  )
  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Edit details</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>Save</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-8">
          <form onSubmit={onSubmit} className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading level="h2">Compliance details</Heading>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Registration number</Label>
                <Input {...form.register("registration_number")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Tax ID</Label>
                <Input {...form.register("tax_id")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Status</Label>
                <Controller control={form.control} name="status" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {COMPANY_STATUSES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                    </Select.Content>
                  </Select>
                )} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Industry</Label>
                <Input {...form.register("industry")} />
              </div>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---- Add document ----------------------------------------------------------

const AddDocumentModal = ({ companyId }: { companyId: string }) => {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const form = useForm({
    defaultValues: {
      title: "",
      document_type: "kyc",
      visibility: "investor",
    },
  })
  const { mutateAsync: uploadFile, isPending: isUploading } = useFileUpload()
  const { mutateAsync, isPending } = useAddDocument(companyId, {
    onSuccess: () => {
      toast.success("Document added")
      form.reset()
      setFile(null)
      setOpen(false)
    },
    onError: (e) => toast.error(e?.message || "Failed to add document"),
  })
  const onSubmit = form.handleSubmit(async (v) => {
    if (!file) {
      toast.error("Choose a file to upload")
      return
    }
    // Upload via the inbuilt media API, then record the document with the
    // returned URL/key.
    const uploaded = await uploadFile({ files: [file] } as any)
    const uploadedFile = uploaded?.files?.[0]
    if (!uploadedFile?.url) {
      toast.error("Upload failed")
      return
    }
    return mutateAsync({
      title: v.title || file.name,
      document_type: v.document_type,
      file_key: (uploadedFile as any).id ?? uploadedFile.url,
      file_url: uploadedFile.url,
      file_name: file.name,
      mime_type: file.type || null,
      file_size: file.size ?? null,
      visibility: v.visibility,
    })
  })
  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Add document</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending || isUploading} onClick={onSubmit}>Add</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-8">
          <form onSubmit={onSubmit} className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading level="h2">Add a document</Heading>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Title</Label>
              <Input placeholder="Shareholders Agreement 2026" {...form.register("title", { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Type</Label>
                <Controller control={form.control} name="document_type" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {DOCUMENT_TYPES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                    </Select.Content>
                  </Select>
                )} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Visibility</Label>
                <Controller control={form.control} name="visibility" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {["private", "investor", "public"].map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                    </Select.Content>
                  </Select>
                )} />
              </div>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">File</Label>
              <Input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <Text size="small" className="text-ui-fg-subtle">
                  {file.name}
                </Text>
              )}
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---- Section ---------------------------------------------------------------

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
        <EditComplianceModal companyId={companyId} company={company} />
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

      {/* Document vault */}
      <div className="flex flex-col gap-y-2 px-6 py-5">
        <div className="flex items-center justify-between">
          <Text weight="plus">Document vault</Text>
          <AddDocumentModal companyId={companyId} />
        </div>
        {isPending ? (
          <div className="flex flex-col gap-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : documents.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">No documents yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Title</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Visibility</Table.HeaderCell>
                <Table.HeaderCell>Link</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {documents.map((d) => (
                <Table.Row key={d.id}>
                  <Table.Cell>{d.title}</Table.Cell>
                  <Table.Cell><Badge>{d.document_type ?? "other"}</Badge></Table.Cell>
                  <Table.Cell>{d.visibility ?? "investor"}</Table.Cell>
                  <Table.Cell>
                    {d.file_url ? (
                      <a href={d.file_url} target="_blank" rel="noreferrer" className="text-ui-fg-interactive">
                        Open
                      </a>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}
