import { Link, PencilSquare, Trash } from "@medusajs/icons";
import {
  Avatar,
  Container,
  Copy,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../../common/action-menu";
import {
  useDeleteMediaFolder,
  useShareMediaFolder,
  useUnshareMediaFolder,
} from "../../../hooks/api/media-folders";
import { GeneralSectionSkeleton } from "../../table/skeleton";
import { AdminMediaFolder } from "../../../hooks/api/media-folders";
import { useMemo } from "react";

export type FolderGeneralSectionProps = {
  folder: AdminMediaFolder;
};

export const FolderGeneralSection = ({ folder }: FolderGeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();
  const navigate = useNavigate();
  const { mutateAsync } = useDeleteMediaFolder(folder.id);
  const shareMutation = useShareMediaFolder(folder.id);
  const unshareMutation = useUnshareMediaFolder(folder.id);

  const shareToken = (folder.metadata as Record<string, any> | null)?.share_token as string | undefined;
  const shareBase = useMemo(() => {
    const envBase =
      import.meta.env.VITE_MEDIA_GALLERY_BASE_URL &&
      (import.meta.env.VITE_MEDIA_GALLERY_BASE_URL as string).replace(/\/$/, "");

    if (envBase) {
      return envBase;
    }

    if (typeof window !== "undefined") {
      return window.location.origin;
    }

    return "";
  }, []);
  const shareUrl = useMemo(() => {
    if (!shareToken || !shareBase) {
      return null;
    }
    return `${shareBase}/apps/media-gallery/?folder=${folder.id}&token=${shareToken}`;
  }, [folder.id, shareBase, shareToken]);

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

  const handleShare = async () => {
    try {
      const res = await shareMutation.mutateAsync();
      const token = res.share_token;
      const baseUrl = shareBase || (typeof window !== "undefined" ? window.location.origin : "");
      const url = `${baseUrl}/?folder=${folder.id}&token=${token}`;

      toast.success(t("media.folders.share.enabled"), {
        description: t("media.folders.share.linkReady"),
        action: {
          altText: t("actions.copy"),
          label: t("actions.copy"),
          onClick: () => navigator.clipboard.writeText(url),
        },
      });
    } catch (error: any) {
      toast.error(error.message || t("media.folders.share.error"));
    }
  };

  const handleUnshare = async () => {
    try {
      await unshareMutation.mutateAsync();
      toast.success(t("media.folders.share.disabled"));
    } catch (error: any) {
      toast.error(error.message || t("media.folders.share.error"));
    }
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
                    label: shareToken
                      ? t("media.folders.share.disable")
                      : t("media.folders.share.enable"),
                    icon: <Link />,
                    onClick: shareToken ? handleUnshare : handleShare,
                    disabled: shareToken
                      ? unshareMutation.isPending
                      : shareMutation.isPending,
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
      {shareToken && shareUrl && (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {t("media.folders.share.linkLabel")}
          </Text>
          <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base bg-ui-bg-base p-3">
            <Text size="xsmall" className="break-all text-ui-fg-muted">
              {shareUrl}
            </Text>
            <div>
              <Copy
                content={shareUrl}
                variant="mini"
              >
                {t("actions.copy")}
              </Copy>
            </div>
          </div>
        </div>
      )}
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
