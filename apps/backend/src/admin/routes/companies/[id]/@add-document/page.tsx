import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { FileUpload } from "../../../../components/common/file-upload"
import { useFileUpload } from "../../../../hooks/api/upload"
import { useAddDocument } from "../../../../hooks/api/investor-financials-admin"

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

const VISIBILITIES = ["private", "investor", "public"] as const

const SUPPORTED = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

const AddDocumentForm = ({ companyId }: { companyId: string }) => {
  const { handleSuccess } = useRouteModal()
  const [file, setFile] = useState<File | null>(null)
  const [previewName, setPreviewName] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { title: "", document_type: "kyc", visibility: "investor" },
  })
  const { mutateAsync: uploadFile, isPending: isUploading } = useFileUpload()
  const { mutateAsync, isPending } = useAddDocument(companyId, {
    onSuccess: () => {
      toast.success("Document added")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to add document"),
  })

  const onSubmit = form.handleSubmit(async (v) => {
    if (!file) {
      toast.error("Choose a file to upload")
      return
    }
    // Upload via the inbuilt media API, then record the document with the
    // returned URL/key (same pattern as the designs media upload).
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
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button size="small" type="submit" isLoading={isPending || isUploading}>Add</Button>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-auto py-8">
        <div className="flex w-full max-w-lg flex-col gap-y-6">
          <Heading level="h2">Add a document</Heading>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Title</Label>
            <Input placeholder="Shareholders Agreement 2026" {...form.register("title")} />
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
                    {VISIBILITIES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                  </Select.Content>
                </Select>
              )} />
            </div>
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">File</Label>
            <FileUpload
              label="Drag & drop a file or click to upload"
              hint="PDF, image or Word document"
              multiple={false}
              formats={SUPPORTED}
              onUploaded={(files) => {
                const f = files[0]?.file ?? null
                setFile(f)
                setPreviewName(f?.name ?? null)
              }}
            />
            {previewName && (
              <Text size="small" className="text-ui-fg-subtle">Selected: {previewName}</Text>
            )}
          </div>
        </div>
      </RouteFocusModal.Body>
    </form>
  )
}

const AddDocumentPage = () => {
  const { id } = useParams()
  return (
    <RouteFocusModal>
      <AddDocumentForm companyId={id!} />
    </RouteFocusModal>
  )
}

export default AddDocumentPage
