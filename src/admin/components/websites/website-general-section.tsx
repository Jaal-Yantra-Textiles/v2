import { PencilSquare } from "@medusajs/icons";
import {
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
  StatusBadge,
  Avatar,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { ActionMenu } from "../common/action-menu";
import { AdminWebsite } from "../../hooks/api/websites";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

const websiteStatusColor = (status: string) => {
  switch (status) {
    case "Active":
      return "green";
    case "Inactive":
      return "red";
    case "Maintenance":
      return "orange";
    default:
      return "grey";
  }
};

interface WebsiteGeneralSectionProps {
  website: AdminWebsite;
}

export function WebsiteGeneralSection({ website }: WebsiteGeneralSectionProps) {
  const { t } = useTranslation();
  const prompt = usePrompt();
  
  const handleDelete = async () => {
    const res = await prompt({
      title: t("websites.delete.title"),
      description: t("websites.delete.description", {
        domain: website.domain,
      }),
      verificationInstruction: t("general.typeToConfirm"),
      verificationText: website.domain,
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    });

    if (!res) {
      return;
    }

    // TODO: Implement delete functionality
    toast.error("Delete functionality not implemented yet");
  };

  

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading>{website.name}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
          <StatusBadge color={websiteStatusColor(website.status as string)}>
            {website.status}
          </StatusBadge>

          <ActionMenu groups={[{
              actions: [{
                label: t("actions.edit"),
                icon: <PencilSquare />,
                to: "edit",
              },],
             
          }]} />
        </div>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Domain
        </Text>
        <Text size="small" leading="compact">
          <a
            href={`https://${website.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            {website.domain}
          </a>
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Name
        </Text>
        <Text size="small" leading="compact">
          {website.name}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Description
        </Text>
        <Text size="small" leading="compact">
          {website.description}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Favicon
        </Text>
        <Avatar
           src={website.favicon_url}
           fallback="M"
          />
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Created At
        </Text>
        <Text size="small" leading="compact">
          {format(new Date(website.created_at), "PPP")}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Last Updated
        </Text>
        <Text size="small" leading="compact">
          {format(new Date(website.updated_at), "PPP")}
        </Text>
      </div>
    </Container>
    
  );
}
