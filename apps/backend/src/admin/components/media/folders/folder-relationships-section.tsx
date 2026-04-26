import { Container, Heading, Text } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { AdminMediaFolder } from "../../../hooks/api/media-folders";
import { Link } from "react-router-dom";

export type FolderRelationshipsSectionProps = {
  folder: AdminMediaFolder;
};

export const FolderRelationshipsSection = ({ folder }: FolderRelationshipsSectionProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-y-4">
      {/* Parent Folder */}
      {folder.parent_folder && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">{t("media.folders.parentFolder")}</Heading>
          </div>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.name")}
            </Text>
            <Text size="small" leading="compact">
              <Link 
                to={`/media/${folder.parent_folder.id}`}
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              >
                {folder.parent_folder.name}
              </Link>
            </Text>
          </div>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("fields.path")}
            </Text>
            <Text size="small" leading="compact">
              {folder.parent_folder.path}
            </Text>
          </div>
        </Container>
      )}

      {/* Child Folders */}
      {folder.child_folders && folder.child_folders.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">{t("media.folders.childFolders", { count: folder.child_folders.length })}</Heading>
          </div>
          <div className="px-6 py-4">
            <div className="flex flex-col gap-y-2">
              {folder.child_folders.map((childFolder) => (
                <div key={childFolder.id} className="border rounded p-3">
                  <Link 
                    to={`/media/${childFolder.id}`}
                    className="font-medium text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                  >
                    {childFolder.name}
                  </Link>
                  <div className="text-ui-fg-subtle text-sm">{childFolder.path}</div>
                </div>
              ))}
            </div>
          </div>
        </Container>
      )}

      {/* Media Files Count */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{t("media.folders.mediaFiles")}</Heading>
        </div>
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {t("fields.count")}
          </Text>
          <Text size="small" leading="compact">
            {folder.media_files ? folder.media_files.length : 0}
          </Text>
        </div>
      </Container>
    </div>
  );
};
