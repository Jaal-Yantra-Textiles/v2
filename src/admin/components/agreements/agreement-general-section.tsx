import { PencilSquare, Trash, ArrowUpRightOnBox } from "@medusajs/icons";
import { Container, Heading, Text, usePrompt } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { ActionMenu } from "../common/action-menu";
import { AdminAgreement } from "../../hooks/api/agreement";

type AgreementGeneralSectionProps = {
  agreement: AdminAgreement;
};

export const AgreementGeneralSection = ({ agreement }: AgreementGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();

  const handleDelete = async () => {
    const res = await prompt({
      title: t("general.areYouSure"),
      description: t("agreements.delete.confirmation", {
        name: agreement.title,
      }),
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
      variant: "danger",
    });

    if (!res) {
      return;
    }

    // TODO: Implement delete functionality
    console.log("Delete agreement:", agreement.id);
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Heading level="h2">{agreement.title}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("agreements.subtitle")}
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <PencilSquare />,
                  label: t("actions.edit"),
                  to: `edit`,
                },
              ],
            },
            {
              actions: [
                {
                  icon: <Trash />,
                  label: t("actions.delete"),
                  onClick: handleDelete,
                },
              ],
            },
          ]}
        />
      </div>
      <div className="text-ui-fg-subtle grid divide-y">
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("agreements.fields.title.label")}
            </Text>
            <Text size="small" leading="compact">
              {agreement.title || "-"}
            </Text>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("agreements.fields.content.label")}
            </Text>
            <div className="flex items-center gap-2">
              {agreement.content ? (
                <ArrowUpRightOnBox className="h-4 w-4 text-ui-fg-muted" />
              ) : (
                <Text size="small" leading="compact">
                  {agreement.content || "-"}
                </Text>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("agreements.fields.templateKey.label")}
            </Text>
            <Text size="small" leading="compact">
              {agreement.templateKey || "-"}
            </Text>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("agreements.fields.optional.label")}
            </Text>
            <Text size="small" leading="compact">
              {agreement.optional || "-"}
            </Text>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("agreements.fields.status.label")}
            </Text>
            <Text size="small" leading="compact">
              {agreement.status || "-"}
            </Text>
          </div>
      </div>
    </Container>
  );
};
