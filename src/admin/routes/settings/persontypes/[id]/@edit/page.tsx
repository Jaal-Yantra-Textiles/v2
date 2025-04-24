import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { usePersonType } from "../../../../../hooks/api/persontype";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditPersonTypeForm } from "../../../../../components/edits/edit-person-type";

const PersonTypeEdit = () => {
  const { id } = useParams();
  const { t } = useTranslation();

  const { personType, isPending, isError, error } = usePersonType(id!);

  const ready = !isPending && !!personType;

  if (isError) {
    throw error;
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("personTypes.edit.header")}</Heading>
      </RouteDrawer.Header>
      {ready && <EditPersonTypeForm personType={personType} />}
    </RouteDrawer>
  );
};

export default PersonTypeEdit;
