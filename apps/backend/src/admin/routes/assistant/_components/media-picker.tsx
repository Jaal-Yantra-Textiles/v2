/**
 * Media picker for the chat, shown in the route modal at /assistant/media.
 *
 * Finds an already-hosted image in the media library and attaches its URL to
 * the next chat message — the same `attachments` array a direct upload feeds,
 * so the server-side contract (POST /admin/assistant/chat) is untouched: the
 * picker just produces `{ url, name, mime_type }` references instead of bytes.
 *
 * Selection is capped by the room left under the composer's attachment limit;
 * adding beyond that is refused here, at the UI, rather than silently dropped
 * by the page's backstop slice.
 */
import { useEffect, useMemo, useState } from "react"
import { CheckCircleSolid, Photo } from "@medusajs/icons"
import { Button, Input, Select, Text, Tooltip, toast } from "@medusajs/ui"
import { RouteFocusModal } from "@/components/modal/route-focus-modal"
import { useRouteModal } from "@/components/modal/use-route-modal"
import {
  useMediaFiles,
  useFolders,
  type MediaFile,
} from "@/hooks/api/media"
import { getThumbUrl } from "@/lib/media"
import { useAssistantPage } from "./assistant-page-context"

/** Absolute URL for a library file, matching how MediaUpload builds them. */
const mediaFileUrl = (file: MediaFile): string =>
  file.file_path?.startsWith("http")
    ? file.file_path
    : `${process.env.NEXT_PUBLIC_AWS_S3 || ""}${file.file_path}`

const MediaTile = ({
  file,
  isSelected,
  onToggle,
}: {
  file: MediaFile
  isSelected: boolean
  onToggle: () => void
}) => {
  const url = mediaFileUrl(file)
  const displayName = file.original_name || file.file_name

  return (
    <Tooltip content={displayName}>
      <button
        type="button"
        onClick={onToggle}
        className={`relative h-20 w-20 cursor-pointer overflow-hidden rounded border shadow-sm transition-colors ${
          isSelected
            ? "border-ui-border-interactive"
            : "border-ui-border-base hover:border-ui-border-strong"
        }`}
      >
        {isSelected ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
            <CheckCircleSolid className="text-ui-fg-on-color" />
          </div>
        ) : null}
        <img
          src={getThumbUrl(url, { width: 160, quality: 70, fit: "cover" })}
          alt={displayName}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </button>
    </Tooltip>
  )
}

export const MediaPickerModal = () => {
  const { attachments, addAttachments, maxAttachments } = useAssistantPage()
  const { handleSuccess } = useRouteModal()

  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selected, setSelected] = useState<MediaFile[]>([])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: foldersData } = useFolders()
  const folders = foldersData?.folders || []

  const room = maxAttachments - attachments.length
  const roomLeft = Math.max(0, room - selected.length)

  const {
    files,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMediaFiles({
    file_type: "image",
    folder_id: folderId,
    search: debouncedSearch || undefined,
    limit: 40,
  })

  const toggle = (file: MediaFile) => {
    if (selected.find((f) => f.id === file.id)) {
      setSelected(selected.filter((f) => f.id !== file.id))
      return
    }
    if (room <= 0) {
      toast.error(
        `Attachment limit reached — remove one from the composer first (max ${maxAttachments} per message)`
      )
      return
    }
    if (selected.length >= room) {
      toast.error(`You can select at most ${room} more image${room === 1 ? "" : "s"}`)
      return
    }
    setSelected([...selected, file])
  }

  const confirm = () => {
    if (!selected.length) return
    addAttachments(
      selected.map((f) => ({
        url: mediaFileUrl(f),
        name: f.original_name || f.file_name,
        mime_type: f.mime_type || "image/*",
      }))
    )
    handleSuccess()
  }

  const folderSelect = useMemo(
    () => (
      <div className="w-full max-w-[260px]">
        <Text size="xsmall" className="text-ui-fg-subtle mb-1">
          Folder
        </Text>
        <Select
          value={folderId || "all"}
          onValueChange={(val) => setFolderId(val === "all" ? undefined : val)}
          disabled={isLoading}
        >
          <Select.Trigger>
            <Select.Value placeholder="All Folders" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All Folders</Select.Item>
            {folders.map((folder) => (
              <Select.Item key={folder.id} value={folder.id}>
                {folder.path}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
    ),
    [folderId, folders, isLoading]
  )

  return (
    <>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <span className="text-xl md:text-2xl">Attach media</span>
        </RouteFocusModal.Title>
        <RouteFocusModal.Description asChild>
          <span className="text-ui-fg-subtle mt-1 text-small">
            Pick images from the media library to send with your next message —
            the assistant reads them on request.
          </span>
        </RouteFocusModal.Description>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex w-full flex-col gap-y-4 px-6 py-8 md:px-8">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            {folderSelect}
            <div className="w-full max-w-[260px]">
              <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                Search
              </Text>
              <Input
                type="text"
                placeholder="Search images…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                size="small"
                disabled={isLoading}
              />
            </div>
            <Text size="xsmall" className="text-ui-fg-muted ml-auto">
              {selected.length
                ? `${selected.length} selected · ${roomLeft} slot${roomLeft === 1 ? "" : "s"} left`
                : `${room > 0 ? `${room} slot${room === 1 ? "" : "s"} left` : "Attachment limit reached"}`}
            </Text>
          </div>

          {isError ? (
            <Text className="text-ui-fg-error">Failed to load files.</Text>
          ) : files.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Photo className="text-ui-fg-muted mb-2" />
              <Text size="small" className="text-ui-fg-subtle">
                {search || folderId ? "No images match your filters" : "No images found"}
              </Text>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
                {files.map((file) => (
                  <MediaTile
                    key={file.id}
                    file={file}
                    isSelected={!!selected.find((f) => f.id === file.id)}
                    onToggle={() => toggle(file)}
                  />
                ))}
              </div>
              {hasNextPage && !isLoading ? (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                  className="self-center"
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer className="px-6 py-3 md:px-8 md:py-4">
        <div className="flex w-full items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button
            variant="primary"
            disabled={!selected.length}
            onClick={confirm}
          >
            Add to chat{selected.length ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}
