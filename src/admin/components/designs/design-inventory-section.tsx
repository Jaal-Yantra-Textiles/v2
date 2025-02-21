import { Container, Heading } from "@medusajs/ui";
import { Plus } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { AdminDesign } from "../../hooks/api/designs";  
import { useNavigate } from "react-router-dom";


interface DesignInventorySectionProps {
  design: AdminDesign;
}

export const DesignInventorySection = ({ design }: DesignInventorySectionProps) => {
  const navigate  = useNavigate()
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
                  onClick: () => {
                    navigate(`/designs/${design.id}/addinv`);
                  },
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
