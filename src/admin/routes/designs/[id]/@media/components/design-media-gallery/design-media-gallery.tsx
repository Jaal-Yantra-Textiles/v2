import { ArrowDownTray, ThumbnailBadge, Trash, TriangleLeftMini, TriangleRightMini } from "@medusajs/icons"
import { Button, IconButton, Text, Tooltip, clx } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AdminDesign } from "../../../../../../hooks/api/designs"
import { useDesignMediaViewContext } from "../design-media-view"
import { RouteFocusModal } from "../../../../../../components/modal/route-focus-modal"
import { useUpdateDesign } from "../../../../../../hooks/api/designs"

type DesignMediaGalleryProps = {
  design: AdminDesign
}

export const DesignMediaGallery = ({ design }: DesignMediaGalleryProps) => {
  const [curr, setCurr] = useState<number>(0)
  const { t } = useTranslation()
  const { goToEdit } = useDesignMediaViewContext()
  const { mutateAsync, isPending } = useUpdateDesign(design.id)

  const media = getMedia(design.media_files || [])

  const next = useCallback(() => {
    if (isPending || !media.length) {
      return
    }

    setCurr((prev) => (prev + 1) % media.length)
  }, [media, isPending])

  const prev = useCallback(() => {
    if (isPending || !media.length) {
      return
    }

    setCurr((prev) => (prev - 1 + media.length) % media.length)
  }, [media, isPending])

  const goTo = useCallback(
    (index: number) => {
      if (isPending) {
        return
      }

      setCurr(index)
    },
    [isPending]
  )

  const handleDownloadCurrent = () => {
    if (isPending || !media.length) {
      return
    }

    const a = document.createElement("a") as HTMLAnchorElement & {
      download: string
    }

    a.href = media[curr].url
    a.download = "image"
    a.target = "_blank"

    a.click()
  }

  const handleDeleteCurrent = async () => {
    if (!media.length) return
    
    const current = media[curr]
    const mediaToKeep = design.media_files?.filter(m => m.id !== current.id) || []

    if (curr === media.length - 1 && curr > 0) {
      setCurr((prev) => prev - 1)
    }

    await mutateAsync({
      media_files: mediaToKeep,
      // If this was the thumbnail, clear it
      ...(current.isThumbnail ? { metadata: { thumbnail: "" } } : {})
    })
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        next()
      } else if (e.key === "ArrowLeft") {
        prev()
      }
    }

    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [next, prev])

  const noMedia = !media.length

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <IconButton
            size="small"
            type="button"
            onClick={handleDeleteCurrent}
            disabled={noMedia}
          >
            <Trash />
            <span className="sr-only">
              {t("designs.media.deleteImageLabel", "Delete image")}
            </span>
          </IconButton>
          <IconButton
            size="small"
            type="button"
            onClick={handleDownloadCurrent}
            disabled={noMedia}
          >
            <ArrowDownTray />
            <span className="sr-only">
              {t("designs.media.downloadImageLabel", "Download image")}
            </span>
          </IconButton>
          <Button variant="secondary" size="small" onClick={goToEdit}>
            {t("actions.edit", "Edit")}
          </Button>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-col overflow-hidden">
        <Canvas curr={curr} media={media} />
        <Preview
          curr={curr}
          media={media}
          prev={prev}
          next={next}
          goTo={goTo}
        />
      </RouteFocusModal.Body>
    </div>
  )
}

const Canvas = ({ media, curr }: { media: Media[]; curr: number }) => {
  const { t } = useTranslation()
  const { goToEdit } = useDesignMediaViewContext()

  if (media.length === 0) {
    return (
      <div className="bg-ui-bg-subtle flex size-full flex-col items-center justify-center gap-y-4 pb-8 pt-6">
        <div className="flex flex-col items-center">
          <Text
            size="small"
            leading="compact"
            weight="plus"
            className="text-ui-fg-subtle"
          >
            {t("designs.media.emptyState.header", "No media files available")}
          </Text>
          <Text size="small" className="text-ui-fg-muted">
            {t("designs.media.emptyState.description", "Upload media files to showcase your design")}
          </Text>
        </div>
        <Button size="small" variant="secondary" onClick={goToEdit}>
          {t("designs.media.emptyState.action", "Upload media files")}
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-ui-bg-subtle relative size-full overflow-hidden">
      <div className="flex size-full items-center justify-center p-6">
        <div className="relative inline-block max-h-full max-w-full">
          {media[curr].isThumbnail && (
            <div className="absolute left-2 top-2">
              <Tooltip content={t("designs.media.thumbnailTooltip", "This is the thumbnail image")}>
                <ThumbnailBadge />
              </Tooltip>
            </div>
          )}
          <img
            src={media[curr].url}
            alt=""
            className="object-fit shadow-elevation-card-rest max-h-[calc(100vh-200px)] w-auto rounded-xl object-contain"
          />
        </div>
      </div>
    </div>
  )
}

const MAX_VISIBLE_ITEMS = 8

const Preview = ({
  media,
  curr,
  prev,
  next,
  goTo,
}: {
  media: Media[]
  curr: number
  prev: () => void
  next: () => void
  goTo: (index: number) => void
}) => {
  if (!media.length) {
    return null
  }

  const getVisibleItems = (media: Media[], index: number) => {
    if (media.length <= MAX_VISIBLE_ITEMS) {
      return media
    }

    const half = Math.floor(MAX_VISIBLE_ITEMS / 2)
    const start = (index - half + media.length) % media.length
    const end = (start + MAX_VISIBLE_ITEMS) % media.length

    if (end < start) {
      return [...media.slice(start), ...media.slice(0, end)]
    } else {
      return media.slice(start, end)
    }
  }

  const visibleItems = getVisibleItems(media, curr)

  return (
    <div className="flex shrink-0 items-center justify-center gap-x-2 border-t p-3">
      <IconButton
        size="small"
        variant="transparent"
        className="text-ui-fg-muted"
        type="button"
        onClick={prev}
      >
        <TriangleLeftMini />
      </IconButton>
      <div className="flex items-center gap-x-2">
        {visibleItems.map((item) => {
          const isCurrentImage = item.id === media[curr].id
          const originalIndex = media.findIndex((i) => i.id === item.id)

          return (
            <button
              type="button"
              onClick={() => goTo(originalIndex)}
              className={clx(
                "transition-fg size-7 overflow-hidden rounded-[4px] outline-none",
                {
                  "shadow-borders-focus": isCurrentImage,
                }
              )}
              key={item.id}
            >
              <img src={item.url} alt="" className="size-full object-cover" />
            </button>
          )
        })}
      </div>
      <IconButton
        size="small"
        variant="transparent"
        className="text-ui-fg-muted"
        type="button"
        onClick={next}
      >
        <TriangleRightMini />
      </IconButton>
    </div>
  )
}

type Media = {
  id: string
  url: string
  isThumbnail: boolean
}

const getMedia = (mediaFiles: any[]): Media[] => {
  if (!mediaFiles?.length) {
    return []
  }

  return mediaFiles.map((media) => ({
    id: media.id,
    url: media.url,
    isThumbnail: media.isThumbnail || false,
  }))
}

export default DesignMediaGallery
