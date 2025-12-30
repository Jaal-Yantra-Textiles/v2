import { Button, Container, Heading, Badge, Text, Tooltip } from "@medusajs/ui";
import { AdminDesign, DesignSizeSet } from "../../hooks/api/designs";
import { useNavigate, useParams } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { PencilSquare } from "@medusajs/icons";

interface DesignSizesSectionProps {
  design: AdminDesign;
}

const renderMeasurements = (measurements: Record<string, number>) => (
  <div className="p-2 space-y-1">
    {Object.entries(measurements).map(([name, value]) => (
      <div key={name} className="flex items-center gap-x-2">
        <Text size="small" leading="compact" weight="plus">
          {name}:
        </Text>
        <Text size="small" leading="compact">
          {value}
        </Text>
      </div>
    ))}
  </div>
);

export const DesignSizesSection = ({ design }: DesignSizesSectionProps) => {
  const { id } = useParams();
  const navigate = useNavigate();

  const handleManageSizes = () => {
    navigate(`/designs/${id}/edit-size`);
  };

  const structuredSizeSets: DesignSizeSet[] = design.size_sets || [];
  const customSizes = design.custom_sizes || {};

  const hasStructuredSizes = structuredSizeSets.length > 0;
  const hasLegacySizes = Object.keys(customSizes).length > 0;
  const hasSizes = hasStructuredSizes || hasLegacySizes;

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
                    label: "Edit Size",
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
            {hasStructuredSizes
              ? structuredSizeSets.map((sizeSet) => (
                  <Tooltip
                    key={sizeSet.id || sizeSet.size_label}
                    content={renderMeasurements(sizeSet.measurements || {})}
                  >
                    <div>
                      <Badge className="text-sm font-medium px-3 py-1.5 cursor-pointer hover:bg-ui-bg-base-hover transition-colors">
                        {sizeSet.size_label}
                      </Badge>
                    </div>
                  </Tooltip>
                ))
              : Object.entries(customSizes).map(([sizeName, measurements]) => (
                  <Tooltip
                    key={sizeName}
                    content={renderMeasurements(
                      (measurements as Record<string, number>) || {},
                    )}
                  >
                    <div>
                      <Badge className="text-sm font-medium px-3 py-1.5 cursor-pointer hover:bg-ui-bg-base-hover transition-colors">
                        {sizeName}
                      </Badge>
                    </div>
                  </Tooltip>
                ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-ui-fg-subtle">
            <p>No sizes defined yet</p>
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
