import { CommandLineSolid, PencilSquare, Trash } from "@medusajs/icons";
import { useTranslation } from "react-i18next";
import {
  AdminSocialPlatform,
  useDeleteSocialPlatform,
  useTestImapConnection,
  useSetupResendWebhook,
} from "../../hooks/api/social-platforms";
import { CommonSection, CommonField } from "../common/section-views";
import { usePrompt, toast } from "@medusajs/ui";
import { useNavigate } from "react-router-dom";

export const SocialPlatformGeneralSection = ({ platform }: { platform: AdminSocialPlatform }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const prompt = usePrompt();
  const { mutateAsync: deletePlatform } = useDeleteSocialPlatform(platform.id);
  const { mutateAsync: testConnection } = useTestImapConnection();
  const { mutateAsync: setupWebhook } = useSetupResendWebhook();

  const apiConfig = platform.api_config as Record<string, any> | null;
  const isEmail = platform.category === "email";
  const isCommunication = platform.category === "communication";
  const isSms = platform.category === "sms";
  const isPayment = platform.category === "payment";
  const isShipping = platform.category === "shipping";
  const providerType = apiConfig?.provider as string | undefined;

  const handleDelete = async () => {
    const confirmation = await prompt({
      title: t("socialPlatform.delete.title", "Delete Social Platform?"),
      description: t(
        "socialPlatform.delete.description",
        "Are you sure you want to delete this social platform? This action cannot be undone."
      ),
      confirmText: t("actions.delete", "Delete"),
      cancelText: t("actions.cancel", "Cancel"),
    });

    if (confirmation) {
      try {
        await deletePlatform();
        toast.success(t("socialPlatform.toasts.deleted", "External Platform deleted"));
        navigate("/settings/external-platforms");
      } catch (e: any) {
        toast.error(e.message || t("errors.general", "An unexpected error occurred."));
      }
    }
  };

  const handleTestConnection = async () => {
    if (providerType !== "imap" || !apiConfig) return;
    try {
      const result = await testConnection({
        host: apiConfig.host,
        port: apiConfig.port,
        user: apiConfig.user || apiConfig.username,
        password: apiConfig.password,
        tls: apiConfig.tls,
        mailbox: apiConfig.mailbox,
      });
      toast.success(result.message || "Connection successful");
    } catch (e: any) {
      toast.error(e.message || "Connection failed");
    }
  };

  const handleSetupWebhook = async () => {
    if (providerType !== "resend") return;
    try {
      const result = await setupWebhook({ platform_id: platform.id });
      toast.success(`Webhook registered at ${result.webhook_url}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to register webhook");
    }
  };

  const actionGroups: any[] = [
    {
      actions: [
        {
          label: t("actions.edit"),
          icon: <PencilSquare />,
          to: `edit`,
        },
      ],
    },
    {
      actions: [
        {
          label: t("Add Access"),
          icon: <CommandLineSolid />,
          to: `access`,
        },
      ],
    },
  ];

  // Add email-specific actions
  if (isEmail && providerType === "imap") {
    actionGroups.push({
      actions: [
        {
          label: "Test Connection",
          icon: <CommandLineSolid />,
          onClick: handleTestConnection,
        },
      ],
    });
  }

  if (isEmail && providerType === "resend") {
    actionGroups.push({
      actions: [
        {
          label: "Setup Webhook",
          icon: <CommandLineSolid />,
          onClick: handleSetupWebhook,
        },
      ],
    });
  }

  actionGroups.push({
    actions: [
      {
        label: t("actions.delete"),
        icon: <Trash />,
        onClick: handleDelete,
        variant: "danger",
      },
    ],
  });

  const generalFields: CommonField[] = [
    {
      label: t("fields.name", "Name"),
      value: platform.name,
    },
    {
      label: t("fields.description", "Description"),
      value: platform.description || "-",
    },
    {
      label: "Category",
      value: platform.category || "-",
    },
    {
      label: "Authentication Type",
      value: platform.auth_type || "-",
    },
    {
      label: "Status",
      value: platform.status || "-",
    },
  ];

  // Show provider type for categories that have it
  if (providerType) {
    generalFields.push({
      label: "Provider",
      value: providerType.charAt(0).toUpperCase() + providerType.slice(1),
    });
  }

  // Category-specific detail fields
  if (isEmail && apiConfig) {
    if (providerType === "imap") {
      generalFields.push(
        {
          label: "Host",
          value: apiConfig.host ? `${apiConfig.host}:${apiConfig.port || 993}` : "-",
        },
        {
          label: "Mailbox",
          value: apiConfig.mailbox || "INBOX",
        },
        {
          label: "TLS",
          value: apiConfig.tls !== false ? "Enabled" : "Disabled",
        }
      );
    }
    if (providerType === "resend") {
      generalFields.push({
        label: "Inbound Domain",
        value: apiConfig.inbound_domain || "-",
      });
    }
  } else if (isCommunication && apiConfig) {
    generalFields.push(
      {
        label: "Phone Number ID",
        value: apiConfig.phone_number_id || "-",
      },
      {
        label: "Access Token",
        value: (apiConfig.access_token_encrypted || apiConfig.access_token) ? "Configured" : "Not set",
      },
      {
        label: "App Secret",
        value: (apiConfig.app_secret_encrypted || apiConfig.app_secret) ? "Configured" : "Not set",
      },
      {
        label: "Webhook Verify Token",
        value: (apiConfig.webhook_verify_token_encrypted || apiConfig.webhook_verify_token) ? "Configured" : "Not set",
      }
    );
  } else if (isSms && apiConfig) {
    if (providerType === "twilio") {
      generalFields.push(
        { label: "Account SID", value: apiConfig.account_sid || "-" },
        { label: "From Number", value: apiConfig.from_number || "-" }
      );
    } else if (providerType === "messagebird") {
      generalFields.push(
        { label: "Originator", value: apiConfig.originator || "-" }
      );
    }
  } else if (isPayment && apiConfig) {
    generalFields.push(
      { label: "Mode", value: (apiConfig.mode || "test").charAt(0).toUpperCase() + (apiConfig.mode || "test").slice(1) }
    );
    if (apiConfig.publishable_key) {
      generalFields.push({ label: "Publishable Key", value: apiConfig.publishable_key });
    }
  } else if (isShipping && apiConfig) {
    generalFields.push(
      { label: "Mode", value: (apiConfig.mode || "test").charAt(0).toUpperCase() + (apiConfig.mode || "test").slice(1) }
    );
    if (apiConfig.account_number) {
      generalFields.push({ label: "Account Number", value: apiConfig.account_number });
    }
  } else {
    generalFields.push(
      {
        label: "Base URL",
        value: platform.base_url ? (
          <a href={platform.base_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            {platform.base_url}
          </a>
        ) : "-",
      },
      {
        label: "Icon URL",
        value: platform.icon_url ? (
          <a href={platform.icon_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            {platform.icon_url}
          </a>
        ) : "-",
      }
    );
  }

  return (
    <CommonSection
      title={t("socialPlatform.general.title", "General Information")}
      description={t("socialPlatform.general.description", "Basic details of the social platform.")}
      fields={generalFields}
      actionGroups={actionGroups}
    />
  );
};
