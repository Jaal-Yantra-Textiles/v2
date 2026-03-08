import {
  Button,
  Container,
  Heading,
  Text,
  Badge,
  clx,
  toast,
} from "@medusajs/ui"
import { Photos, Trash, ArrowPath } from "@medusajs/icons"
import { useState } from "react"
import {
  useDesignMediaFolder,
  useLinkDesignMediaFolder,
  useUnlinkDesignMediaFolder,
} from "../../hooks/api/use-design-media-folder"
import { useMediaFolders, AdminMediaFolder } from "../../hooks/api/media-folders"
import { getThumbUrl } from "../../lib/media"

interface DesignMediaFolderSectionProps {
  design: { id: string }
}

function FolderPickerModal({
  onPick,
  onClose,
}: {
  onPick: (folder: AdminMediaFolder) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState("")
  const { folders, isLoading } = useMediaFolders({ q: search || undefined, limit: 50 })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-2xl border border-ui-border-base bg-ui-bg-base shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ui-border-base">
          <Heading level="h3">Select media folder</Heading>
          <button
            onClick={onClose}
            className="text-ui-fg-muted hover:text-ui-fg-base transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-ui-border-base">
          <input
            type="text"
            placeholder="Search folders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2 text-sm text-ui-fg-base placeholder:text-ui-fg-muted outline-none focus:border-ui-border-strong"
            autoFocus
          />
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Text size="small" className="text-ui-fg-muted">Loading folders…</Text>
            </div>
          )}
          {!isLoading && folders.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Text size="small" className="text-ui-fg-muted">No folders found</Text>
            </div>
          )}
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => onPick(folder)}
              className="w-full flex items-center gap-x-3 px-5 py-3 text-left hover:bg-ui-bg-subtle transition-colors border-b border-ui-border-base last:border-0"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ui-bg-subtle border border-ui-border-base overflow-hidden">
                {folder.media_files?.[0] ? (
                  <img
                    src={getThumbUrl(folder.media_files[0].file_path, { width: 80, quality: 70 })}
                    className="h-full w-full object-cover"
                    alt=""
                  />
                ) : (
                  <Photos className="text-ui-fg-muted" />
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <Text size="small" weight="plus" className="text-ui-fg-base truncate">
                  {folder.name}
                </Text>
                <Text size="xsmall" className="text-ui-fg-muted truncate">
                  {folder.path}
                  {folder.media_files?.length
                    ? ` · ${folder.media_files.length} files`
                    : ""}
                </Text>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export const DesignMediaFolderSection = ({ design }: DesignMediaFolderSectionProps) => {
  const [pickerOpen, setPickerOpen] = useState(false)

  const { data: folder, isLoading } = useDesignMediaFolder(design.id)
  const linkMutation = useLinkDesignMediaFolder(design.id)
  const unlinkMutation = useUnlinkDesignMediaFolder(design.id)

  const handlePick = async (picked: AdminMediaFolder) => {
    setPickerOpen(false)
    await linkMutation.mutateAsync(picked.id)
  }

  const handleUnlink = async () => {
    await unlinkMutation.mutateAsync()
  }

  const imageFiles = folder?.media_files?.filter(
    (f) => f.file_type === "image" || f.mime_type?.startsWith("image/")
  ) ?? []

  const isBusy = linkMutation.isPending || unlinkMutation.isPending

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <Heading level="h2">Media Folder</Heading>
            {folder && (
              <Badge size="xsmall" color="green">Linked</Badge>
            )}
          </div>
          <div className="flex items-center gap-x-2">
            {folder && (
              <Button
                size="small"
                variant="secondary"
                onClick={handleUnlink}
                disabled={isBusy}
              >
                <Trash />
                Unlink
              </Button>
            )}
            <Button
              size="small"
              variant={folder ? "secondary" : "primary"}
              onClick={() => setPickerOpen(true)}
              disabled={isBusy}
            >
              {folder ? <ArrowPath /> : <Photos />}
              {folder ? "Change" : "Link folder"}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Text size="small" className="text-ui-fg-muted">Loading…</Text>
          </div>
        )}

        {!isLoading && !folder && (
          <div className="flex flex-col items-center gap-y-2 py-8 px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ui-bg-subtle">
              <Photos className="text-ui-fg-muted" />
            </div>
            <Text size="small" weight="plus" className="text-ui-fg-subtle">
              No media folder linked
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted text-center max-w-xs">
              Link a media folder to associate photoshoot images with this design.
              When this design is promoted to Commerce Ready, the folder's images
              will be used to create the draft product.
            </Text>
          </div>
        )}

        {!isLoading && folder && (
          <div className="flex flex-col gap-y-3 px-6 py-4">
            <div className="flex items-center gap-x-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ui-border-base bg-ui-bg-subtle overflow-hidden">
                {imageFiles[0] ? (
                  <img
                    src={getThumbUrl(imageFiles[0].file_path, { width: 80, quality: 70 })}
                    className="h-full w-full object-cover"
                    alt=""
                  />
                ) : (
                  <Photos className="text-ui-fg-muted" />
                )}
              </div>
              <div>
                <Text size="small" weight="plus" className="text-ui-fg-base">
                  {folder.name}
                </Text>
                <Text size="xsmall" className="text-ui-fg-muted">
                  {folder.path} · {imageFiles.length} image{imageFiles.length !== 1 ? "s" : ""}
                </Text>
              </div>
            </div>

            {/* Image grid preview — max 6 */}
            {imageFiles.length > 0 && (
              <div className="grid grid-cols-6 gap-1.5">
                {imageFiles.slice(0, 6).map((f, i) => (
                  <div
                    key={f.id}
                    className={clx(
                      "relative aspect-square overflow-hidden rounded-md border border-ui-border-base",
                      i === 0 && "col-span-2 row-span-2"
                    )}
                  >
                    <img
                      src={getThumbUrl(f.file_path, { width: 200, quality: 75, fit: "cover" })}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {i === 0 && (
                      <div className="absolute left-1 top-1">
                        <Badge size="xsmall" color="blue">Thumbnail</Badge>
                      </div>
                    )}
                    {i === 5 && imageFiles.length > 6 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Text size="xsmall" weight="plus" className="text-white">
                          +{imageFiles.length - 6}
                        </Text>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Container>

      {pickerOpen && (
        <FolderPickerModal
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}
