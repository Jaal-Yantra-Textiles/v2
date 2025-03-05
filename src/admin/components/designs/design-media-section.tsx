import { Button, Container, Heading } from "@medusajs/ui";
import { AdminDesign } from "../../hooks/api/designs";
import { useNavigate, useParams } from "react-router-dom";

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
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h2">Media</Heading>
        <Button
          variant="secondary"
          onClick={handleManageMedia}
        >
          Manage Media
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        {design.media_files && design.media_files.length > 0 ? (
          design.media_files.map((media, index) => (
            <div 
              key={media.id || index} 
              className="relative group aspect-square overflow-hidden rounded-md border border-ui-border-base">
              <img
                src={media.url}
                alt={`Design media ${index + 1}`}
                className="w-full h-full object-cover"
              />
              {media.isThumbnail && (
                <div className="absolute top-2 right-2 bg-ui-bg-highlight text-ui-fg-base text-xs px-2 py-1 rounded-sm">
                  Thumbnail
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center py-8 text-ui-fg-subtle">
            <p>No media files yet</p>
            <Button
              variant="secondary"
              size="small"
              onClick={handleManageMedia}
              className="mt-2"
            >
              Add Media
            </Button>
          </div>
        )}
      </div>
    </Container>
  );
};
