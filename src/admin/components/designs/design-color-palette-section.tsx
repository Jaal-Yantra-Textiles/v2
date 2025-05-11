import { Container, Heading, Text, Tooltip } from "@medusajs/ui";
import { PencilSquare } from "@medusajs/icons";
import { useTranslation } from "react-i18next";
import { AdminDesign, ColorPalette } from "../../hooks/api/designs";
import { ActionMenu } from "../common/action-menu";

interface DesignColorPaletteSectionProps {
  design: AdminDesign;
}

export const DesignColorPaletteSection = ({ design }: DesignColorPaletteSectionProps) => {
  const { t } = useTranslation();
  
  // Get color palette from design or initialize empty array
  const colorPalette = design.color_palette || [];
  
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Heading level="h2">{t("Color Palette")}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Colors used in this design
            </Text>
          </div>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("actions.edit"),
                    icon: <PencilSquare />,
                    to: "edit-color-palette",
                  },
                ],
              },
              
            ]}
          />
        </div>
      </div>
      <div className="px-6 py-4">
        <div className="flex flex-wrap gap-3">
          {colorPalette.length > 0 ? (
            colorPalette.map((color: ColorPalette, index: number) => (
              <Tooltip key={`color-${index}`} content={`${color.name} (${color.code})`}>
                <div className="flex flex-col items-center">
                  <div 
                    className="w-12 h-12 rounded-md border border-ui-border-base shadow-sm cursor-pointer"
                    style={{ backgroundColor: color.code }}
                    aria-label={color.name}
                  />
                  <Text className="text-ui-fg-subtle mt-1" size="small">
                    {color.name}
                  </Text>
                </div>
              </Tooltip>
            ))
          ) : (
            <div className="w-full py-6 flex justify-center">
              <Text className="text-ui-fg-subtle">No colors in palette</Text>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
};
