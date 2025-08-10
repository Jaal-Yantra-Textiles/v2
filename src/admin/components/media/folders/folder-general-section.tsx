import { PencilSquare, Trash } from "@medusajs/icons";
import {
  Avatar,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../../common/action-menu";
import { useDeleteMediaFolder } from "../../../hooks/api/media-folders";
import { GeneralSectionSkeleton } from "../../table/skeleton";
import { AdminMediaFolder } from "../../../hooks/api/media-folders";

export type FolderGeneralSectionProps = {
  folder: AdminMediaFolder;
};

export const FolderGeneralSection = ({ folder }: FolderGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();
  const navigate = useNavigate();
  const { mutateAsync } = useDeleteMediaFolder(folder.id);

  const handleDelete = async () => {
    const res = await prompt({
      title: t("media.folders.delete.title"),
      description: t("media.folders.delete.description", {
        name: folder.name,
      }),
      verificationInstruction: t("general.typeToConfirm"),
      verificationText: folder.name,
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    });

    if (!res) {
      return;
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success(
          t("media.folders.delete.successToast", {
            name: folder.name,
          }),
        );
        navigate("/media", { replace: true });
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  };

  if (!folder) {
    return <GeneralSectionSkeleton rowCount={3} />;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Avatar
            src={undefined}
            fallback={folder.name.charAt(0) || "F"}
          />
          <Heading>{folder.name}</Heading>
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
          {folder.name || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.slug")}
        </Text>
        <Text size="small" leading="compact">
          {folder.slug || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.path")}
        </Text>
        <Text size="small" leading="compact">
          {folder.path || "-"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.level")}
        </Text>
        <Text size="small" leading="compact">
          {folder.level || "0"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.public")}
        </Text>
        <Text size="small" leading="compact">
          {folder.is_public ? t("general.yes") : t("general.no")}
        </Text>
      </div>
      {folder.description && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {t("fields.description")}
          </Text>
          <Text size="small" leading="compact">
            {folder.description}
          </Text>
        </div>
      )}
    </Container>
  );
};
