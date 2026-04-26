import {
  Container,
  Heading,
  Text,
  Button,
  Textarea,
  Badge,
  toast,
} from "@medusajs/ui"
import { ChatBubble } from "@medusajs/icons"
import { useState } from "react"
import {
  useMediaComments,
  useCreateMediaComment,
  MediaComment,
} from "../../../hooks/api/media-comments"

interface MediaCommentsSectionProps {
  mediaId: string
  mediaName?: string
}

export const MediaCommentsSection = ({
  mediaId,
  mediaName,
}: MediaCommentsSectionProps) => {
  const [newComment, setNewComment] = useState("")
  const { comments, isLoading } = useMediaComments(mediaId)
  const createMutation = useCreateMediaComment(mediaId)

  const handleSubmit = async () => {
    if (!newComment.trim()) return

    await createMutation.mutateAsync(
      { content: newComment.trim() },
      {
        onSuccess: () => {
          toast.success("Comment added")
          setNewComment("")
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">
            {mediaName ? `Comments on ${mediaName}` : "Comments"}
          </Heading>
          {comments.length > 0 && (
            <Badge size="2xsmall" color="grey">
              {comments.length}
            </Badge>
          )}
        </div>
      </div>

      {/* Add comment form */}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Textarea
          placeholder="Write a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={2}
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="small"
            onClick={handleSubmit}
            disabled={!newComment.trim()}
            isLoading={createMutation.isPending}
          >
            Add Comment
          </Button>
        </div>
      </div>

      {/* Comments list */}
      {isLoading ? (
        <div className="px-6 py-6 text-center">
          <Text size="small" className="text-ui-fg-muted">
            Loading comments...
          </Text>
        </div>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center gap-y-2 px-6 py-6">
          <ChatBubble className="text-ui-fg-muted" />
          <Text size="small" className="text-ui-fg-muted">
            No comments yet
          </Text>
        </div>
      ) : (
        <div className="flex flex-col">
          {comments.map((comment: MediaComment) => (
            <div
              key={comment.id}
              className="flex flex-col gap-y-1 px-6 py-3 border-b border-ui-border-base last:border-b-0"
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
                    {new Date(comment.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {comment.content}
              </Text>
            </div>
          ))}
        </div>
      )}
    </Container>
  )
}

/**
 * Shows comments for all media files in a folder, grouped by file.
 */
interface FolderAllCommentsSectionProps {
  folderId: string
  mediaFiles?: Array<{ id: string; file_name: string; original_name: string }>
}

export const FolderAllCommentsSection = ({
  mediaFiles,
}: FolderAllCommentsSectionProps) => {
  const [expandedMediaId, setExpandedMediaId] = useState<string | null>(null)

  if (!mediaFiles || mediaFiles.length === 0) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center gap-x-2 px-6 py-4">
        <Heading level="h2">Media Comments</Heading>
      </div>

      <div className="flex flex-col">
        {mediaFiles.map((media) => (
          <div key={media.id} className="border-b border-ui-border-base last:border-b-0">
            <button
              className="flex w-full items-center justify-between px-6 py-3 hover:bg-ui-bg-base-hover text-left"
              onClick={() =>
                setExpandedMediaId(
                  expandedMediaId === media.id ? null : media.id
                )
              }
            >
              <Text size="small" weight="plus">
                {media.original_name || media.file_name}
              </Text>
              <Text size="xsmall" className="text-ui-fg-muted">
                {expandedMediaId === media.id ? "Hide" : "Show"} comments
              </Text>
            </button>
            {expandedMediaId === media.id && (
              <div className="px-2 pb-4">
                <MediaCommentsSection mediaId={media.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Container>
  )
}
