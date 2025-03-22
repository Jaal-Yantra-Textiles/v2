import { useState, useEffect } from "react";
import ColorPaletteEditor from "../../../../components/edits/edit-color-palette";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";
import { useDesign, useUpdateDesign } from "../../../../hooks/api/designs";
import { useParams } from "react-router-dom";
import { Button } from "@medusajs/ui";
import { toast } from "sonner";

export default function EditColorPalettePage() {
  const { id } = useParams();
  const { design, refetch } = useDesign(id!);
  const { mutateAsync: updateDesign, isPending } = useUpdateDesign(id!);
  const [colorPaletteJson, setColorPaletteJson] = useState<string>('[]');
  
  // Update the JSON when the design data is loaded
  useEffect(() => {
    if (design?.color_palette) {
      setColorPaletteJson(JSON.stringify(design.color_palette, null, 2));
    }
  }, [design]);

  const handleSave = async () => {
    try {
      // Parse the JSON to validate it and use in the API call
      const colorPalette = JSON.parse(colorPaletteJson);
      
      // Call the API to update the design
      await updateDesign({
        color_palette: colorPalette,
      });
      
      toast.success("Color palette saved successfully");
      await refetch();
    } catch (error) {
      toast.error("Failed to save color palette");
      console.error(error);
    }
  };

  return (
    <RouteFocusModal>
      <div className="space-y-6">
        <ColorPaletteEditor 
          value={colorPaletteJson} 
          onChange={setColorPaletteJson} 
        />
        <div className="flex justify-end">
          <Button 
            variant="primary" 
            onClick={handleSave}
            isLoading={isPending}
          >
            Save Changes
          </Button>
        </div>
      </div>
    </RouteFocusModal>
  );
}
