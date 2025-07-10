import { PencilSquare, Trash, Newspaper, MapPin } from "@medusajs/icons";
import {
  Avatar,
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { useDeletePerson } from "../../hooks/api/persons";

const personStatusColor = (status: string) => {
  switch (status) {
    case "Onboarding":
      return "grey";
    case "stalled":
      return "orange";
    case "onboarding finished":
      return "green";
    case "conflicted":
      return "red";
    default:
      return "grey";
  }
};

export interface AdminPerson {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: string;
  created_at: string;
  state: string;
  avatar: string;
}

type PersonGeneralSectionProps = {
  person: AdminPerson;
};

export const PersonGeneralSection = ({ person }: PersonGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();
  const navigate = useNavigate();
  const { mutateAsync } = useDeletePerson(person.id);

  const name = [person.first_name, person.last_name].filter(Boolean).join(" ");

  const handleDelete = async () => {
    const res = await prompt({
      title: t("persons.delete.title"),
      description: t("persons.delete.description", {
        email: person.email,
      }),
      verificationInstruction: t("general.typeToConfirm"),
      verificationText: person.email,
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
            email: person.email,
          }),
        );
        navigate("/persons", { replace: true });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Avatar
            src={person.avatar || "https://avatars.githubusercontent.com/u/10656202?v=4"}
            fallback={name.charAt(0) || "M"}
          />
          <Heading>{person.email || name}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
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
                    label: 'Add Note',
                    icon: <Newspaper />,
                    to: "addnote",
                  },
                ],
              },
              {
                actions: [
                  {
                    label: "Geocode Addresses",
                    icon: <MapPin />,
                    to: "geocode",
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
          {t("fields.name")}
        </Text>
        <Text size="small" leading="compact">
          {name || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.state")}
        </Text>
        <Text size="small" leading="compact">
          <StatusBadge color={personStatusColor(person.state)}>
            {`${person.state}`}
          </StatusBadge>
        </Text>
      </div> 
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.dateOfBirth")}
        </Text>
        <Text size="small" leading="compact">
          {person.date_of_birth || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.createdAt")}
        </Text>
        <Text size="small" leading="compact">
          {person.created_at || "-"}
        </Text>
      </div>
    </Container>
  );
};
