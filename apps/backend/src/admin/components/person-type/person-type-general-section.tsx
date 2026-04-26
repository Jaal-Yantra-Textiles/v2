import { PencilSquare, Trash } from "@medusajs/icons";
import { Container, Heading, Text, toast, usePrompt } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";

import { useDeletePersonType } from "../../hooks/api/persontype";

export interface AdminPersonType {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

type PersonTypeGeneralSectionProps = {
  personType: AdminPersonType;
};

export const PersonTypeGeneralSection = ({
  personType,
}: PersonTypeGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();
  const navigate = useNavigate();
  const { mutateAsync } = useDeletePersonType(personType.id);

  const handleDelete = async () => {
    const res = await prompt({
      title: t("persons.delete.title"),
      description: t("persons.delete.description", {
        email: personType.name,
      }),
      verificationInstruction: t("general.typeToConfirm"),
      verificationText: personType.name,
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    });

    if (!res) {
      return;
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success(
          t("persons.delete.successToast", {
            email: personType.name,
          }),
        );
        navigate("/persontype", { replace: true });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading>{personType.name}</Heading>
        <div className="flex items-center gap-x-2">
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("actions.edit"),
                    icon: <PencilSquare />,
                    to: "edit",
                  },
                ],
              },
              {
                actions: [
                  {
                    label: t("actions.delete"),
                    icon: <Trash />,
                    onClick: handleDelete,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {"Person Type"}
        </Text>
        <Text size="small" leading="compact">
          {personType.description || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.createdAt")}
        </Text>
        <Text size="small" leading="compact">
          {personType.created_at || "-"}
        </Text>
      </div>
    </Container>
  );
};
