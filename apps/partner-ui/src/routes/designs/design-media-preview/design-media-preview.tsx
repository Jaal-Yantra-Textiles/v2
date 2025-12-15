import { ArrowDownTray, TriangleLeftMini, TriangleRightMini } from "@medusajs/icons"
import { Heading, IconButton, Text, clx } from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocation, useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"
import { usePartnerDesign } from "../../../hooks/api/partner-designs"

type Media = {
  id: string
  url: string
  isThumbnail: boolean
}

export const DesignMediaPreview = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Design media</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">Preview design media</span>
      </RouteFocusModal.Description>
      {id ? <DesignMediaPreviewWithId id={id} /> : <DesignMediaPreviewMissingId />}
    </RouteFocusModal>
  )
}

const DesignMediaPreviewMissingId = () => {
  return (
    <div className="flex size-full flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <Heading>Media</Heading>
        </RouteFocusModal.Title>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="overflow-auto">
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Missing design id.
          </Text>
        </div>
      </RouteFocusModal.Body>
    </div>
  )
}

const DesignMediaPreviewWithId = ({ id }: { id: string }) => {
  const { state } = useLocation()
  const initialCurr = typeof (state as any)?.curr === "number" ? (state as any).curr : 0

  const { design, isPending, isError, error } = usePartnerDesign(id)

  const media = useMemo(() => {
    const files = (design as any)?.media_files as
      | Array<{ id?: string; url: string; isThumbnail?: boolean }>
      | undefined

    const arr = files || []

    return arr
      .filter((f) => !!f?.url)
      .map((f, index) => ({
        id: String(f.id || `${index}_${f.url}`),
        url: f.url,
        isThumbnail: !!f.isThumbnail,
      })) as Media[]
  }, [design])

  const [curr, setCurr] = useState<number>(initialCurr)

  useEffect(() => {
    setCurr((prev) => {
      const next = Number.isFinite(initialCurr) ? initialCurr : prev
      if (!media.length) {
        return 0
      }
      return Math.max(0, Math.min(next, media.length - 1))
    })
  }, [initialCurr, media.length])

  const next = useCallback(() => {
    if (!media.length) {
      return
    }

    setCurr((prev) => (prev + 1) % media.length)
  }, [media.length])

  const prev = useCallback(() => {
    if (!media.length) {
      return
    }

    setCurr((prev) => (prev - 1 + media.length) % media.length)
  }, [media.length])

  const goTo = useCallback(
    (index: number) => {
      if (!media.length) {
        return
      }

      const clamped = Math.max(0, Math.min(index, media.length - 1))
      setCurr(clamped)
    },
    [media.length]
  )

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

  const handleDownloadCurrent = () => {
    if (!media.length) {
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

  if (isError) {
    throw error
  }

  const noMedia = !media.length

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between gap-x-2">
          <RouteFocusModal.Title asChild>
            <Heading>Media</Heading>
          </RouteFocusModal.Title>
          <IconButton
            size="small"
            type="button"
            onClick={handleDownloadCurrent}
            disabled={noMedia}
          >
            <ArrowDownTray />
            <span className="sr-only">Download</span>
          </IconButton>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col overflow-hidden">
        <Canvas curr={curr} media={media} isLoading={isPending} />
        <Preview curr={curr} media={media} prev={prev} next={next} goTo={goTo} />
      </RouteFocusModal.Body>
    </div>
  )
}

const Canvas = ({
  media,
  curr,
  isLoading,
}: {
  media: Media[]
  curr: number
  isLoading: boolean
}) => {
  if (isLoading) {
    return (
      <div className="bg-ui-bg-subtle flex size-full items-center justify-center p-6">
        <Text size="small" className="text-ui-fg-subtle">
          Loading...
        </Text>
      </div>
    )
  }

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
            No media files yet
          </Text>
          <Text size="small" className="text-ui-fg-muted">
            Add images to showcase your design
          </Text>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-ui-bg-subtle relative size-full overflow-hidden">
      <div className="flex size-full items-center justify-center p-6">
        <div className="relative inline-block max-h-full max-w-full">
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
    }

    return media.slice(start, end)
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
        <TriangleLeftMini className="rtl:rotate-180" />
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
        <TriangleRightMini className="rtl:rotate-180" />
      </IconButton>
    </div>
  )
}
