import { Button, Container, Heading, Text, Tooltip } from "@medusajs/ui";
import { AdminDesign } from "../../hooks/api/designs";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { MediaPlay, ThumbnailBadge } from "@medusajs/icons";

interface DesignMediaSectionProps {
  design: AdminDesign;
}

export const DesignMediaSection = ({ design }: DesignMediaSectionProps) => {
  const { id } = useParams();
  const navigate = useNavigate();

  // Navigate to media management modal
  const handleManageMedia = () => {
    navigate(`/designs/${id}/media`);
  };

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
      {design.media_files && design.media_files.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4 px-6 py-4">
          {design.media_files.map((media, index) => (
            <div 
              key={media.id || index} 
              className="shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-fg group relative aspect-square size-full cursor-pointer overflow-hidden rounded-[8px]">
              {media.isThumbnail && (
                <div className="absolute left-2 top-2">
                  <Tooltip content={"Thumbnail"}>
                    <ThumbnailBadge />
                  </Tooltip>
                </div>
              )}
              <Link to={`media`} state={{ curr: index }}>
                <img
                  src={media.url}
                  alt={`${design.name} image`}
                  className="size-full object-cover"
                />
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-y-4 pb-8 pt-6">
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
          <Button size="small" variant="secondary" asChild>
            <Link to="media?view=edit">
              Add Media
            </Link>
          </Button>
        </div>
      )}
    </Container>
  );
};
