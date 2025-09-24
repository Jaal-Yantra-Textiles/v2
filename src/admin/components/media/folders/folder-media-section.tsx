import { Button, CommandBar, Container, Heading, Text, Tooltip, clx, toast } from "@medusajs/ui";
import { AdminMediaFolder, MediaFile } from "../../../hooks/api/media-folders";
import { Link } from "react-router-dom";
import { MediaPlay, ThumbnailBadge } from "@medusajs/icons";
import { ActionMenu } from "../../common/action-menu";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sdk } from "../../../lib/config";
import { mediaFolderDetailQueryKeys } from "../../../hooks/api/media-folders/use-media-folder-detail";

interface FolderMediaSectionProps {
  folder: AdminMediaFolder;
}

export const FolderMediaSection = ({ folder }: FolderMediaSectionProps) => {
  const [selection, setSelection] = useState<Record<string, true>>({})
  const queryClient = useQueryClient()
  const selectedCount = useMemo(() => Object.keys(selection).length, [selection])

  const toggleSelect = (id?: string) => (e?: React.MouseEvent) => {
    if (!id) return
    if (e) e.preventDefault()
    setSelection((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  const clearSelection = () => setSelection({})

  const handleDeleteSelected = async () => {
    const ids = Object.keys(selection)
    if (!ids.length) return
    const loading = toast.loading("Deleting media...", { duration: Infinity })
    let success = 0
    try {
      for (const id of ids) {
        try {
          await sdk.client.fetch(`/admin/medias/file/${id}`, { method: "DELETE" })
          success++
        } catch (err: any) {
          toast.error(err?.message || `Failed to delete ${id}`)
        }
      }
      toast.success(`Deleted ${success}/${ids.length} item(s)`) 
      clearSelection()
      await queryClient.invalidateQueries({ queryKey: mediaFolderDetailQueryKeys.detail(folder.id) })
    } finally {
      toast.dismiss(loading)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Media</Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: 'Manage Media',
                  icon: <MediaPlay />,
                  to: "media",
                },
              ],
            },
          ]}
        />
      </div>
      {folder.media_files && folder.media_files.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4 p-6">
          {folder.media_files.map((media: MediaFile, index) => {
            const id = media.id // Only use real IDs; skip selection if absent
            const isSelected = !!selection[id]
            const tile = (
              <div
                onClick={id ? toggleSelect(id) : undefined}
                className={clx(
                  "shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-fg group relative aspect-square size-full cursor-pointer overflow-hidden rounded-lg",
                  { "shadow-borders-focus ring-2 ring-ui-border-strong": isSelected }
                )}
              >
                {media.metadata?.is_thumbnail && (
                  <div className="absolute left-2 top-2">
                    <Tooltip content={"Thumbnail"}>
                      <ThumbnailBadge />
                    </Tooltip>
                  </div>
                )}
                <img src={media.file_path} alt={`${folder.name} image`} className="size-full object-cover" />
                {isSelected && (
                  <div className="absolute inset-0 bg-black/20">
                    <div className="absolute right-2 top-2 h-5 w-5 rounded-full border-2 border-white bg-emerald-400/90" />
                  </div>
                )}
              </div>
            )
            return (
              <div key={id || `media-${index}`}>
                {id ? (
                  selectedCount > 0 ? (
                    tile
                  ) : (
                    <Link to={`media`} state={{ curr: index }}>
                      {tile}
                    </Link>
                  )
                ) : (
                  // If the media has no id, disable selection and just show as a static tile/link
                  <Link to={`media`} state={{ curr: index }}>
                    {tile}
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-y-4 pb-8 pt-6">
          <div className="flex flex-col items-center">
            <Text
              size="small"
              leading="compact"
              weight="plus"
              className="text-ui-fg-subtle"
            >
              No media files available
            </Text>
            <Text size="small" className="text-ui-fg-muted">
              Upload media files to showcase your folder
            </Text>
          </div>
          <Button size="small" variant="secondary" asChild>
            <Link to="media?view=edit">
              Add media files
            </Link>
          </Button>
        </div>
      )}
      <CommandBar open={selectedCount > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command action={handleDeleteSelected} label="Delete" shortcut="d" />
          <CommandBar.Seperator />
          <CommandBar.Command action={clearSelection} label="Clear" shortcut="esc" />
        </CommandBar.Bar>
      </CommandBar>
    </Container>
  );
};
