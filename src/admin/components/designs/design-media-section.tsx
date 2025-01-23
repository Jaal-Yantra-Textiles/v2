import { Button, Container, Heading } from "@medusajs/ui";
import { AdminDesign } from "../../hooks/api/designs";


interface DesignMediaSectionProps {
  design: AdminDesign;
}

export const DesignMediaSection = ({ design }: DesignMediaSectionProps) => {
  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h2">Media</Heading>
        <Button
          variant="secondary"
          onClick={() => {/* TODO: Implement media upload */}}
        >
          Upload Media
        </Button>
      </div>
      <div className="mt-4">
        {/* <MediaGrid mediaItems={design.media || []} /> */}
      </div>
    </Container>
  );
};
