import { useParams } from "react-router-dom";
import { Heading } from "@medusajs/ui";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import ColorPaletteEditor from "../../../../components/edits/edit-color-palette";
import { useDesign } from "../../../../hooks/api/designs";

export default function EditColorPalettePage() {
  const { id } = useParams();
  const { design, isLoading } = useDesign(id!);

  if (isLoading || !design) return null;

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit Color Palette</Heading>
      </RouteDrawer.Header>
      <ColorPaletteEditor design={design} />
    </RouteDrawer>
  );
}
