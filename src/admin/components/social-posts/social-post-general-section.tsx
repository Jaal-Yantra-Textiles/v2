import { AdminSocialPost } from "../../hooks/api/social-posts"
import { CommonField, CommonSection } from "../common/section-views"
import { useTranslation } from "react-i18next"
import dayjs from "dayjs"
import { PencilSquare, Trash, Newspaper } from "@medusajs/icons"

export const SocialPostGeneralSection = ({
  post,
}: {
  post: AdminSocialPost
}) => {
  const { t } = useTranslation()


  const actionGroups = [
    {
      actions: [
        {
          label: t("Edit notes"),
          icon: <Newspaper />,
          to: `notes`, // Relative path for editing
        },
      ],
    },
    {
        actions: [
          {
            label: t("actions.edit"),
            icon: <PencilSquare />,
            to: `edit`, // Relative path for editing
          },
        ],
      },
    {
      actions: [
        {
          label: t("actions.delete"),
          icon: <Trash />,
          onClick: () => {}, // Assuming CommonSection supports a danger variant for buttons
        },
      ],
    },
  ];

  const fields: CommonField[] = [
    {
      label: t("fields.name", "Name"),
      value: post.name,
    },
    {
      label: t("fields.status", "Status"),
      value: post.status,
    },
    {
      label: t("fields.scheduled_at", "Scheduled At"),
      value: post.scheduled_at ? dayjs(post.scheduled_at).format("YYYY-MM-DD HH:mm") : "-",
    },
    {
      label: t("fields.posted_at", "Posted At"),
      value: post.posted_at ? dayjs(post.posted_at).format("YYYY-MM-DD HH:mm") : "-",
    },
  ]

  return (
    <CommonSection
      title={post.name}
      description={t(
        "socialPost.general.description",
        "Basic details of the social post."
      )}
      fields={fields}
      actionGroups={actionGroups}
    />
  )
}
