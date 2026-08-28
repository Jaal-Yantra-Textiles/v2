import { useState } from "react"
import { Container, Heading, IconButton, Text, toast } from "@medusajs/ui"
import { DocumentText, Trash } from "@medusajs/icons"

import { FileUpload } from "../../../components/common/file-upload"
import { useFileUpload } from "../../../hooks/api/upload"
import {
  useAttachPaymentSubmissionDocuments,
  useDeletePaymentSubmissionDocument,
} from "../../../hooks/api/payment-submissions"

export type SubmissionDocument = {
  id?: string
  url: string
  filename?: string
  mimeType?: string
  size?: number
  uploaded_at?: string
}

const readableSize = (size?: number) => {
  if (!size || size < 0) return null
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Attachments on a payout — bills, invoices, transfer receipts.
 *
 * 🔑 Rendered at EVERY status, and deliberately so. `documents` could only be
 * set when the submission was created, but the document that proves a payout
 * happened — the bank receipt — does not exist until after the money moves, by
 * which point the submission is Approved or Paid. A record that closes at the
 * moment its evidence starts arriving guarantees the evidence lives in
 * somebody's inbox instead.
 *
 * Attaching cannot change what is owed: the route touches the documents array
 * and nothing else, so none of the reasons the other write routes refuse a
 * settled submission apply here.
 */
export const SubmissionDocuments = ({
  submissionId,
  documents,
}: {
  submissionId: string
  documents: SubmissionDocument[]
}) => {
  const [uploading, setUploading] = useState(false)
  const { mutateAsync: uploadFile } = useFileUpload()
  const { mutateAsync: attach, isPending: isAttaching } =
    useAttachPaymentSubmissionDocuments()
  const { mutateAsync: removeDocument } = useDeletePaymentSubmissionDocument()

  /**
   * Upload first, then attach in ONE call.
   *
   * Attaching per file would leave a half-attached set behind any failure, and
   * the route appends to what it reads — so two overlapping requests can each
   * read the same array and the second would drop the first's file.
   */
  const onUploaded = async (files: { file: File; url: string }[]) => {
    if (!files?.length) return

    setUploading(true)
    try {
      const uploaded: SubmissionDocument[] = []

      for (const { file } of files) {
        const res = await uploadFile({ files: [file] })
        const f = res.files?.[0]
        if (f?.id && f?.url) {
          uploaded.push({
            id: f.id,
            url: f.url,
            filename: file.name,
            mimeType: file.type || undefined,
            size: typeof file.size === "number" ? file.size : undefined,
          })
        }
      }

      if (!uploaded.length) {
        toast.error("Nothing was uploaded")
        return
      }

      await attach({ id: submissionId, documents: uploaded })
      toast.success(
        `${uploaded.length} document${uploaded.length === 1 ? "" : "s"} attached`
      )
    } catch (e: any) {
      toast.error(e?.message || "Could not attach the document")
    } finally {
      setUploading(false)
    }
  }

  const onRemove = async (documentId?: string) => {
    if (!documentId) {
      // A legacy attachment written before ids were stored cannot be addressed
      // individually, and deleting by index would race the array it reads.
      toast.error("This attachment has no id and cannot be removed here")
      return
    }

    try {
      await removeDocument({ id: submissionId, document_id: documentId })
      toast.success("Document removed")
    } catch (e: any) {
      toast.error(e?.message || "Could not remove the document")
    }
  }

  return (
    <Container className="p-0">
      <div className="border-b border-ui-border-base px-4 py-3">
        <Heading level="h3">Documents</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Bills, invoices and transfer receipts. Can be attached at any status.
        </Text>
      </div>

      <div className="flex flex-col gap-y-3 p-4">
        <FileUpload
          label={uploading || isAttaching ? "Uploading..." : "Drop files here, or click to browse"}
          hint="Bank receipts, partner invoices — PDF or image"
          multiple
          isLoading={uploading || isAttaching}
          onUploaded={onUploaded}
        />

        {documents.length === 0 ? (
          <Text size="small" className="text-ui-fg-muted">
            No documents attached yet.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-1">
            {documents.map((doc, i) => {
              const size = readableSize(doc.size)

              return (
                <div
                  key={doc.id || `${doc.url}-${i}`}
                  className="flex items-center justify-between rounded-md border border-ui-border-base bg-ui-bg-subtle px-2 py-1"
                >
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-x-2 text-ui-fg-interactive text-sm underline"
                  >
                    <DocumentText className="text-ui-fg-subtle" />
                    <span>{doc.filename || doc.url}</span>
                    {size && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {size}
                      </Text>
                    )}
                  </a>
                  <IconButton
                    size="small"
                    variant="transparent"
                    onClick={() => onRemove(doc.id)}
                  >
                    <Trash />
                  </IconButton>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Container>
  )
}
