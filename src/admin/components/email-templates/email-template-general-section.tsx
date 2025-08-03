import { ArrowUpRightOnBox, PencilSquare, Trash } from "@medusajs/icons";
import { Container, Heading, Text, usePrompt, Badge } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { ActionMenu } from "../common/action-menu";
import { AdminEmailTemplate } from "../../hooks/api/email-templates";
import { Link } from "react-router-dom";

type EmailTemplateGeneralSectionProps = {
  emailTemplate: AdminEmailTemplate;
};

export const EmailTemplateGeneralSection = ({ emailTemplate }: EmailTemplateGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();

  const handleDelete = async () => {
    const res = await prompt({
      title: t("general.areYouSure"),
      description: t("email-templates.delete.confirmation", {
        name: emailTemplate.name,
      }),
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
      variant: "danger",
    });

    if (!res) {
      return;
    }

    // TODO: Implement delete functionality
    console.log("Delete emailTemplate:", emailTemplate.id);
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Heading level="h2">{emailTemplate.name}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("email-templates.subtitle")}
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
              {t("email-templates.fields.name.label")}
            </Text>
            <Text size="small" leading="compact">
              {emailTemplate.name || "-"}
            </Text>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("email-templates.fields.description.label")}
            </Text>
            <Text size="small" leading="compact">
              {emailTemplate.description || "-"}
            </Text>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("agreements.fields.content.label")}
            </Text>
          <div className="flex items-center gap-2">
              {emailTemplate.html_content ? (
                <Link to={`/settings/email-templates/${emailTemplate.id}/editEmailTemplate`}>
                  <ArrowUpRightOnBox className="h-4 w-4 text-ui-fg-muted" />
                </Link>
              ) : (
                <Text size="small" leading="compact">
                  {emailTemplate.html_content || "-"}
                </Text>
              )}
            </div>
            </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("email-templates.fields.to.label")}
            </Text>
            <Text size="small" leading="compact">
              {emailTemplate.to || "-"}
            </Text>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("email-templates.fields.cc.label")}
            </Text>
            <Text size="small" leading="compact">
              {emailTemplate.cc || "-"}
            </Text>
          </div>
          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("email-templates.fields.bcc.label")}
            </Text>
            <Text size="small" leading="compact">
              {emailTemplate.bcc || "-"}
            </Text>
          </div>
      </div>
    </Container>
  );
};
