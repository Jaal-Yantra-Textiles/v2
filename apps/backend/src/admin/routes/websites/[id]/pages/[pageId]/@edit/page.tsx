import { useParams } from "react-router-dom";
import { usePage } from "../../../../../../hooks/api/pages";
import { RouteDrawer } from "../../../../../../components/modal/route-drawer/route-drawer";
import { EditPageForm } from "../../../../../../components/edits/edit-page";
import { useTranslation } from "react-i18next";
import { Spinner } from "../../../../../../components/ui/spinner";

export default function EditDesignPage() {
  const { id, pageId } = useParams();
  const { t } = useTranslation();
  const { page, isLoading } = usePage(id!, pageId!);

  const ready = !!page;

  if (isLoading || !page) {
    return <Spinner></Spinner>
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        {t("pages.edit.header")}
      </RouteDrawer.Header>
        {ready && <EditPageForm page={page} websiteId={id!} />}
    </RouteDrawer>
  );
}
