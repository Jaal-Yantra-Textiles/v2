import { Container, Heading } from "@medusajs/ui";
import { Plus } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { AdminDesign } from "../../hooks/api/designs";


interface DesignInventorySectionProps {
  design: AdminDesign;
}

export const DesignInventorySection = ({ design }: DesignInventorySectionProps) => {
  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h2">Inventory Used</Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Add Inventory",
                  icon: <Plus />,
                  onClick: () => {/* TODO: Implement add inventory */},
                },
              ],
            },
          ]}
        />
      </div>
      <div className="mt-4">
        
      </div>
    </Container>
  );
};
