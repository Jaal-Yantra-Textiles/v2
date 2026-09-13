import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useResolvedDesignId } from "../../../hooks/use-resolved-design-id"
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
  const { t } = useTranslation()
  const id = useResolvedDesignId()

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("partner.designs.media.manageMedia")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("partner.designs.media.uploadDescription")}
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      {id ? <DesignMediaContent id={id} /> : <DesignMediaMissingId />}
    </RouteDrawer>
  )
}

const DesignMediaMissingId = () => {
  const { t } = useTranslation()
  return (
    <>
      <RouteDrawer.Body>
        <Text size="small" className="text-ui-fg-subtle">
          {t("partner.designs.missingId")}
        </Text>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <RouteDrawer.Close asChild>
          <Button size="small" variant="secondary">
            {t("actions.close")}
          </Button>
        </RouteDrawer.Close>
      </RouteDrawer.Footer>
    </>
  )
}

const DesignMediaContent = ({ id }: { id: string }) => {
  const { t } = useTranslation()
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
      toast.error(t("partner.designs.media.addAtLeastOne"))
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
      toast.error(t("partner.designs.media.uploadFailed"))
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
          toast.success(t("partner.designs.media.attached"))
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
              {t("partner.designs.media.uploadIntro")}
            </Text>
          </div>

          <div>
            <FileUpload
              label={t("partner.designs.media.uploadImages")}
              hint={t("partner.designs.media.dropHint")}
              formats={SUPPORTED_FORMATS}
              onUploaded={(uploaded, rejected) => {
                if (rejected?.length) {
                  toast.error(t("partner.designs.media.someRejected"))
                }
                setFiles((prev) => [...prev, ...uploaded])
              }}
            />
          </div>

          <div>
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.designs.media.existing")}: {existing.length}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.designs.media.selected")}: {files.length}
            </Text>
          </div>

          {isDesignPending && (
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.designs.media.loadingDesign")}
            </Text>
          )}
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            onClick={handleSave}
            isLoading={isUploading || isAttaching}
            disabled={!files.length}
          >
            {t("actions.save")}
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}