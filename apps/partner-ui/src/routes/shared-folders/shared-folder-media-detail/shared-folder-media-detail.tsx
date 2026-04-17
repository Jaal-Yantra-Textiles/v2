import {
  Badge,
  Button,
  Heading,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { ArrowDownTray, ChatBubble } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"
import {
  useAddSharedFolderComment,
  usePartnerSharedFolder,
  useSharedFolderMediaComments,
  type MediaComment,
} from "../../../hooks/api/partner-shared-folders"

/**
 * Focus modal that shows a single media file from a shared folder on the left
 * and a threaded comment panel on the right — mirroring the pattern used in
 * the admin media gallery. Opened via /shared-folders/:id/media/:mediaId.
 */
export const SharedFolderMediaDetail = () => {
  const { id, mediaId } = useParams()
  const { shared_folder: folder, isPending } = usePartnerSharedFolder(id!)

  const media = useMemo(
    () => folder?.media_files?.find((m) => m.id === mediaId),
    [folder?.media_files, mediaId]
  )

  const isImage =
    media?.file_type === "image" || media?.mime_type?.startsWith("image/")
  const isVideo =
    media?.file_type === "video" || media?.mime_type?.startsWith("video/")

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Shared folder media</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">Preview and comment on media file</span>
      </RouteFocusModal.Description>

      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-between gap-x-2">
          <div className="flex min-w-0 flex-col">
            <Text size="small" weight="plus" className="truncate">
              {media?.original_name || "File"}
            </Text>
            {!!media?.file_size && (
              <Text size="xsmall" className="text-ui-fg-muted">
                {formatSize(media.file_size)}
              </Text>
            )}
          </div>
          {media?.file_path && (
            <Button
              variant="secondary"
              size="small"
              asChild
              type="button"
            >
              <a
                href={media.file_path}
                target="_blank"
                rel="noopener noreferrer"
                download={media.original_name}
              >
                <ArrowDownTray className="mr-1" />
                Download
              </a>
            </Button>
          )}
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-1 overflow-hidden p-0">
        {/* Left: preview */}
        <div className="bg-ui-bg-subtle flex flex-1 items-center justify-center overflow-hidden p-6">
          {isPending || !media ? (
            <div className="bg-ui-bg-component h-[60%] w-[60%] animate-pulse rounded-xl" />
          ) : isImage ? (
            <img
              src={media.file_path}
              alt={media.original_name}
              className="shadow-elevation-card-rest max-h-[calc(100vh-200px)] max-w-full rounded-xl object-contain"
            />
          ) : isVideo ? (
            <video
              src={media.file_path}
              controls
              className="shadow-elevation-card-rest max-h-[calc(100vh-200px)] max-w-full rounded-xl bg-black"
            />
          ) : (
            <div className="flex flex-col items-center gap-y-2 rounded-lg border border-dashed border-ui-border-base p-10">
              <Text size="small" weight="plus" className="uppercase">
                {media.mime_type?.split("/").pop() || media.file_type}
              </Text>
              <Text size="small" className="text-ui-fg-muted">
                {media.original_name}
              </Text>
              <Button variant="secondary" size="small" asChild>
                <a
                  href={media.file_path}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open file
                </a>
              </Button>
            </div>
          )}
        </div>

        {/* Right: comments panel */}
        <div className="border-ui-border-base flex w-full max-w-sm shrink-0 flex-col border-l">
          <CommentsPanel folderId={id!} mediaId={mediaId!} />
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

const CommentsPanel = ({
  folderId,
  mediaId,
}: {
  folderId: string
  mediaId: string
}) => {
  const [newComment, setNewComment] = useState("")
  const { comments, isPending } = useSharedFolderMediaComments(
    folderId,
    mediaId
  )
  const addComment = useAddSharedFolderComment(folderId, mediaId)

  const handleSubmit = async () => {
    const content = newComment.trim()
    if (!content) return
    await addComment.mutateAsync(
      { content },
      {
        onSuccess: () => {
          toast.success("Comment added")
          setNewComment("")
        },
        onError: (err) => {
          toast.error(err.message)
        },
      }
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-ui-border-base flex items-center gap-x-2 border-b px-4 py-3">
        <Heading level="h3">Comments</Heading>
        {comments.length > 0 && (
          <Badge size="2xsmall" color="grey">
            {comments.length}
          </Badge>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-y-3 overflow-y-auto px-4 py-3">
        {isPending ? (
          <Text size="small" className="text-ui-fg-muted">
            Loading comments...
          </Text>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center gap-y-2 py-10">
            <ChatBubble className="text-ui-fg-muted" />
            <Text size="small" className="text-ui-fg-muted">
              No comments yet. Be the first to comment.
            </Text>
          </div>
        ) : (
          comments.map((comment: MediaComment) => (
            <div
              key={comment.id}
              className="border-ui-border-base flex flex-col gap-y-1 rounded-md border p-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-x-2">
                  <Text size="xsmall" weight="plus">
                    {comment.author_name}
                  </Text>
                  <Badge
                    size="2xsmall"
                    color={comment.author_type === "admin" ? "blue" : "green"}
                  >
                    {comment.author_type}
                  </Badge>
                </div>
                {comment.created_at && (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {new Date(comment.created_at).toLocaleDateString(
                      undefined,
                      {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </Text>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {comment.content}
              </Text>
            </div>
          ))
        )}
      </div>

      <div className="border-ui-border-base flex flex-col gap-y-2 border-t px-4 py-3">
        <Textarea
          placeholder="Write a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        <div className="flex items-center justify-between">
          <Text size="xsmall" className="text-ui-fg-muted">
            Cmd/Ctrl + Enter to submit
          </Text>
          <Button
            variant="secondary"
            size="small"
            onClick={handleSubmit}
            disabled={!newComment.trim()}
            isLoading={addComment.isPending}
          >
            Add Comment
          </Button>
        </div>
      </div>
    </div>
  )
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export const Component = SharedFolderMediaDetail
export const Breadcrumb = () => "Media"
