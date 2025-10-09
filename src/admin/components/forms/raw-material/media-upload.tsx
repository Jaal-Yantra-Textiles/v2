import { CheckCircleSolid } from "@medusajs/icons"
import { Button, Text, Tooltip } from "@medusajs/ui"
import {
  AdminEditorFile,
  useEditorFiles,
} from "../../../hooks/api/editor-files"
import { RoundSpinner } from "../../ui/spinner"
import { getThumbUrl, isImageUrl } from "../../../lib/media"

interface MediaUploadProps {
  selectedUrls: string[]
  handleSelect: (url: string) => void
}

const MediaUpload = ({ selectedUrls, handleSelect }: MediaUploadProps) => {
  const {
    files,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEditorFiles({ limit: 40 })

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <RoundSpinner />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-8">
        <Text className="text-ui-fg-error">Failed to load files.</Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-4 p-6">
      <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        {files.map((file: AdminEditorFile) => {
          const isSelected = selectedUrls.includes(file.url)
          const displayName = decodeURIComponent(file.id.split("/").pop() || file.id);
          
          // Use thumbnail for images to reduce bandwidth and improve performance
          const thumbnailUrl = isImageUrl(file.url) 
            ? getThumbUrl(file.url, { width: 128, quality: 70, fit: "cover" })
            : file.url
          
          return (
            <Tooltip content={displayName} key={file.id}>
              <div
                onClick={() => handleSelect(file.url)}
                className="relative h-20 w-20 cursor-pointer overflow-hidden rounded border bg-ui-bg-subtle shadow-sm"
              >
                {isSelected && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
                    <CheckCircleSolid className="text-ui-fg-on-color" />
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            </Tooltip>
          )
        })}
      </div>

      {hasNextPage && (
        <Button
          variant="secondary"
          size="small"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
          className="self-center"
        >
          {isFetchingNextPage ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  )
}

export default MediaUpload;
