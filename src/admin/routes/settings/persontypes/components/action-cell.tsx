import { PencilSquare, Trash } from "@medusajs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ActionMenu } from "../../../../components/common/action-menu";
import { useDeletePersonType } from "../../../../hooks/api/persontype";
import { AdminPersonType } from "../../../../hooks/api/personandtype";

export const ActionCell = ({ personType }: { personType: AdminPersonType }) => {
  const { t } = useTranslation();
  const { mutateAsync } = useDeletePersonType(personType.id);

  const actions = useMemo(
    () => [
      {
        label: t("actions.edit"),
        icon: <PencilSquare />,
        to: `/settings/persontypes/${personType.id}/edit`,
      },
      {
        label: t("actions.delete"),
        icon: <Trash />,
        onClick: async () => await mutateAsync(),
      },
    ],
    [t, personType, mutateAsync]
  );

  return <ActionMenu groups={[{ actions }]} />;
};
