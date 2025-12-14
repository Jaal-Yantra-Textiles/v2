import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { FileType, FileUpload } from "../../../components/common/file-upload"
import { RouteDrawer, useRouteModal } from "../../../components/modals"
import {
  useAttachPartnerDesignMedia,
  usePartnerDesign,
  useUploadPartnerDesignMedia,
} from "../../../hooks/api/partner-designs"

const SUPPORTED_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/svg+xml",
]

export const DesignMedia = () => {
  const { id } = useParams()

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Manage Media</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Upload and attach media to this design
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      {id ? <DesignMediaContent id={id} /> : <DesignMediaMissingId />}
    </RouteDrawer>
  )
}

const DesignMediaMissingId = () => {
  return (
    <>
      <RouteDrawer.Body>
        <Text size="small" className="text-ui-fg-subtle">
          Missing design id.
        </Text>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <RouteDrawer.Close asChild>
          <Button size="small" variant="secondary">
            Close
          </Button>
        </RouteDrawer.Close>
      </RouteDrawer.Footer>
    </>
  )
}

const DesignMediaContent = ({ id }: { id: string }) => {
  const { handleSuccess } = useRouteModal()

  const { design, isPending: isDesignPending, isError, error } = usePartnerDesign(id)
  const { mutateAsync: uploadMedia, isPending: isUploading } =
    useUploadPartnerDesignMedia(id)
  const { mutateAsync: attachMedia, isPending: isAttaching } =
    useAttachPartnerDesignMedia(id)

  const [files, setFiles] = useState<FileType[]>([])

  const existing = useMemo(() => {
    const mediaFiles = (design as any)?.media_files as
      | Array<{ id?: string; url: string; isThumbnail?: boolean }>
      | undefined

    return mediaFiles || []
  }, [design])

  if (isError) {
    throw error
  }

  const handleSave = async () => {
    if (!files.length) {
      toast.error("Add at least one file")
      return
    }

    const formData = new FormData()
    files.forEach((f) => {
      formData.append("files", f.file)
    })

    const uploadRes = await uploadMedia(formData, {
      onError: (e) => toast.error(e.message),
    }).catch(() => null)

    const uploaded = uploadRes?.files || []

    if (!uploaded.length) {
      toast.error("Failed to upload files")
      return
    }

    await attachMedia(
      {
        media_files: uploaded.map((f) => ({
          id: f.id,
          url: f.url,
          isThumbnail: false,
        })),
      },
      {
        onSuccess: () => {
          toast.success("Media attached")
          handleSuccess()
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <>
      <RouteDrawer.Body>
        <div className="flex flex-col gap-y-6">
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Upload images to attach to this design.
            </Text>
          </div>

          <div>
            <FileUpload
              label="Upload images"
              hint="Drop files here or click to browse"
              formats={SUPPORTED_FORMATS}
              onUploaded={(uploaded, rejected) => {
                if (rejected?.length) {
                  toast.error("Some files were rejected")
                }
                setFiles((prev) => [...prev, ...uploaded])
              }}
            />
          </div>

          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Existing: {existing.length}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Selected: {files.length}
            </Text>
          </div>

          {isDesignPending && (
            <Text size="small" className="text-ui-fg-subtle">
              Loading design...
            </Text>
          )}
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            onClick={handleSave}
            isLoading={isUploading || isAttaching}
            disabled={!files.length}
          >
            Save
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}
