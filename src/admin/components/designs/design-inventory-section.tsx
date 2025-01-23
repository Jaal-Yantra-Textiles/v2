import { Button, Container, Heading } from "@medusajs/ui";
import { AdminDesign } from "../../hooks/api/designs";


interface DesignInventorySectionProps {
  design: AdminDesign;
}

export const DesignInventorySection = ({ design }: DesignInventorySectionProps) => {
  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h2">Inventory Used</Heading>
        <Button
          variant="secondary"
          onClick={() => {/* TODO: Implement add inventory */}}
        >
          Add Inventory
        </Button>
      </div>
      <div className="mt-4">
        
      </div>
    </Container>
  );
};
