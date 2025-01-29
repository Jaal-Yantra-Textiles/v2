import { useParams } from "react-router-dom";
import { useDesign } from "../../../../hooks/api/designs";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { EditDesignForm } from "../../../../components/edits/edit-design";

export default function EditDesignPage() {
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
        <Heading>{t("designs.edit.header")}</Heading>
      </RouteDrawer.Header>
        {ready && <EditDesignForm design={design} />}
    </RouteDrawer>
  );
}
