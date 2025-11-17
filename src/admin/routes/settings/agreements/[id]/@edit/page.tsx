import { useParams, useLoaderData } from "react-router-dom";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditAgreementForm } from "../../../../../components/edits/edit-agreement";
import { useAgreement } from "../../../../../hooks/api/agreement";
import { agreementLoader } from "../loader";

export default function EditAgreementPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const initialData = useLoaderData() as Awaited<ReturnType<typeof agreementLoader>>;
  
  const { agreement: agreement, isLoading } = useAgreement(id!, {
    initialData
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
