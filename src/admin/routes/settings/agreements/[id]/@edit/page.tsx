import { useParams } from "react-router-dom";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditAgreementForm } from "../../../../../components/edits/edit-agreement";
import { useAgreement } from "../../../../../hooks/api/agreement";

export default function EditAgreementPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { agreement: agreement, isLoading } = useAgreement(id!, {
    
  });

  const ready = !!agreement;

  if (isLoading || !agreement) {
    return null; // Add loading state if needed
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("agreement.edit.header")}</Heading>
      </RouteDrawer.Header>
      {ready && <EditAgreementForm agreement={agreement} />}
    </RouteDrawer>
  );
}
