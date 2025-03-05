import { Button, Container, Empty, Heading, Text } from "@medusajs/ui"
import { AdminDesign } from "../../../../../../hooks/api/designs"
import { useDesignMediaViewContext } from "../design-media-view"

type DesignMediaGalleryProps = {
  design: AdminDesign
}

export const DesignMediaGallery = ({ design }: DesignMediaGalleryProps) => {
  const { goToEdit } = useDesignMediaViewContext()

  return (
    <Container>
      <div className="flex flex-col gap-y-4">
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center justify-between">
            <Heading level="h1">Media Gallery</Heading>
            <Button variant="secondary" onClick={goToEdit}>Edit Media</Button>
          </div>
          <Text>View and manage your design media assets</Text>
        </div>

        {!design.media_files || design.media_files.length === 0 ? (
          <Empty 
            title="No media files"
            description="Add media files to your design"
            buttonText="Upload media files"
            buttonAction={goToEdit}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {design.media_files.map((media, index) => (
              <div 
                key={media.id || index} 
                className="relative group aspect-square overflow-hidden rounded-md border border-ui-border-base"
              >
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
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}
