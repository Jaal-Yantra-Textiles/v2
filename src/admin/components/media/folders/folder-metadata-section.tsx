import { Container, Heading, Text } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { AdminMediaFolder } from "../../../hooks/api/media-folders";

export type FolderMetadataSectionProps = {
  folder: AdminMediaFolder;
};

export const FolderMetadataSection = ({ folder }: FolderMetadataSectionProps) => {
  const { t } = useTranslation();

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("media.folders.metadata")}</Heading>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.id")}
        </Text>
        <Text size="small" leading="compact">
          {folder.id}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.createdAt")}
        </Text>
        <Text size="small" leading="compact">
          {folder.created_at ? new Date(folder.created_at).toLocaleString() : 'N/A'}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.updatedAt")}
        </Text>
        <Text size="small" leading="compact">
          {folder.updated_at ? new Date(folder.updated_at).toLocaleString() : 'N/A'}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.sortOrder")}
        </Text>
        <Text size="small" leading="compact">
          {folder.sort_order}
        </Text>
      </div>
    </Container>
  );
};
