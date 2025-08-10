import { Button, Container, Heading, Text, Tooltip } from "@medusajs/ui";
import { AdminMediaFolder, MediaFile } from "../../../hooks/api/media-folders";
import { Link } from "react-router-dom";
import { MediaPlay, ThumbnailBadge } from "@medusajs/icons";
import { ActionMenu } from "../../common/action-menu";

interface FolderMediaSectionProps {
  folder: AdminMediaFolder;
}

export const FolderMediaSection = ({ folder }: FolderMediaSectionProps) => {

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
          {folder.media_files.map((media: MediaFile, index) => (
            <div 
              key={media.id || index} 
              className="shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-fg group relative aspect-square size-full cursor-pointer overflow-hidden rounded-lg">
              {/* Note: MediaFile model doesn't have is_thumbnail field, using a placeholder */}
              {media.metadata?.is_thumbnail && (
                <div className="absolute left-2 top-2">
                  <Tooltip content={"Thumbnail"}>
                    <ThumbnailBadge />
                  </Tooltip>
                </div>
              )}
              <Link to={`media`} state={{ curr: index }}>
                <img
                  src={media.file_path}
                  alt={`${folder.name} image`}
                  className="size-full object-cover"
                />
              </Link>
            </div>
          ))}
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
    </Container>
  );
};
