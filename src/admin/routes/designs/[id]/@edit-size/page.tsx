import { useParams } from "react-router-dom";
import { useDesign } from "../../../../hooks/api/designs";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { EditDesignSizes } from "../../../../components/edits/edit-design-sizes";

export default function EditDesignSizesPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { design, isLoading } = useDesign(id!);

  const ready = !!design;

  if (isLoading || !design) {
    return null; // Add loading state if needed
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("designs.edit.sizes")}</Heading>
      </RouteDrawer.Header>
      {ready && <EditDesignSizes design={design} />}
    </RouteDrawer>
  );
}
