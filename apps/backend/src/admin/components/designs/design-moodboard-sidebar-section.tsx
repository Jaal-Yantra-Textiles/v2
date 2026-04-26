import { Container, Heading, Text, Button } from "@medusajs/ui";
import { BookOpen } from "@medusajs/icons";
import { Link } from "react-router-dom";

import { AdminDesign } from "../../hooks/api/designs";

interface DesignMoodboardSidebarSectionProps {
  design: AdminDesign;
}

export const DesignMoodboardSidebarSection = ({
  design: _design,
}: DesignMoodboardSidebarSectionProps) => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Moodboard</Heading>
      </div>
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Capture references, layout ideas, and inspiration for this design.
        </Text>
        <div className="mt-4">
          <Button size="small" variant="secondary" asChild>
            <Link to="moodboard">
              <span className="inline-flex items-center gap-x-2">
                <BookOpen />
                Open Moodboard
              </span>
            </Link>
          </Button>
        </div>
      </div>
    </Container>
  );
};
