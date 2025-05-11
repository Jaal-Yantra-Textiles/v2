import { Button, Container, Heading, Badge, Text, Tooltip, } from "@medusajs/ui";
import { AdminDesign } from "../../hooks/api/designs";
import { useNavigate, useParams } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { PencilSquare } from "@medusajs/icons"

interface DesignSizesSectionProps {
  design: AdminDesign;
}

export const DesignSizesSection = ({ design }: DesignSizesSectionProps) => {
  const { id } = useParams();
  const navigate = useNavigate();

  // Navigate to sizes management modal
  const handleManageSizes = () => {
    navigate(`/designs/${id}/edit-size`);
  };

  // Check if custom sizes exist and has entries
  const hasSizes = design.custom_sizes && Object.keys(design.custom_sizes).length > 0;

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
      <div className="flex items-center justify-between">
        <Heading level="h2">Sizes</Heading>
        <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: 'Edit Size',
                    icon: <PencilSquare />,
                    to: "edit-size",
                  },
                ],
              },
            ]}
          />
      </div>
      </div>
      <div className="px-6 py-4">
        {hasSizes ? (
          <div className="flex flex-wrap gap-3">
            {Object.entries(design.custom_sizes || {}).map(([sizeName, measurements]) => {
              // Create tooltip content with all measurements
              const tooltipContent = (
                <div className="p-2">
                  {Object.entries(measurements).map(([measurementName, value]) => (
                    <div key={measurementName} className="flex items-center gap-x-2 mb-1 last:mb-0">
                      <Text size="small" leading="compact" weight="plus">
                        {measurementName}:
                      </Text>
                      <Text size="small" leading="compact">
                        {value}
                      </Text>
                    </div>
                  ))}
                </div>
              );
              
              return (
                <Tooltip content={tooltipContent} key={sizeName}>
                  <div>
                    <Badge className="text-sm font-medium px-3 py-1.5 cursor-pointer hover:bg-ui-bg-base-hover transition-colors">{sizeName}</Badge>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-ui-fg-subtle">
            <p>No custom sizes defined yet</p>
            <Button
              variant="secondary"
              size="small"
              onClick={handleManageSizes}
              className="mt-2"
            >
              Add Sizes
            </Button>
          </div>
        )}
      </div>
    </Container>
  );
};
