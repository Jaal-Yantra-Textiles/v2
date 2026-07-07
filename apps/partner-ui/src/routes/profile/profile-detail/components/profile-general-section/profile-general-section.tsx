import { PencilSquare } from "@medusajs/icons"
import { Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ActionMenu } from "../../../../../components/common/action-menu"
import { languages } from "../../../../../i18n/languages"
import type { PartnerUser } from "../../../../../hooks/api/users"

type ProfileGeneralSectionProps = {
  user: PartnerUser
}

export const ProfileGeneralSection = ({ user }: ProfileGeneralSectionProps) => {
  const { i18n, t } = useTranslation()

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ")

  const onboardingStatus = useMemo(() => {
    const partnerId = user.partner_id
    if (!partnerId) {
      return { completed: false }
    }

    if (typeof window === "undefined") {
      return { completed: false }
    }

    try {
      const raw = localStorage.getItem(`partner_onboarding_${partnerId}`)
      if (!raw) {
        return { completed: false }
      }
      const parsed = JSON.parse(raw)
      return { completed: Boolean(parsed?.completed) }
    } catch {
      return { completed: false }
    }
  }, [user.partner_id])

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading>{t("profile.domain")}</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            {t("profile.manageYourProfileDetails")}
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <PencilSquare />,
                  label: t("profile.edit.header"),
                  to: "edit",
                },
              ],
            },
          ]}
        />
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.name")}
        </Text>
        <Text size="small" leading="compact">
          {name || "-"}
        </Text>
      </div>
      <div className="grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.email")}
        </Text>
        <Text size="small" leading="compact">
          {user.email || "-"}
        </Text>
      </div>
      <div className="grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("profile.fields.languageLabel")}
        </Text>
        <Text size="small" leading="compact">
          {languages.find((lang) => lang.code === i18n.language)
            ?.display_name || "-"}
        </Text>
      </div>
      <div className="grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("profile.fields.onboardingLabel")}
        </Text>
        <StatusBadge color={onboardingStatus.completed ? "green" : "red"} className="w-fit">
          {onboardingStatus.completed
            ? t("profile.fields.onboardingCompleted")
            : t("profile.fields.onboardingNotCompleted")}
        </StatusBadge>
      </div>
      {/* TODO: Do we want to implement usage insights in V2? */}
      {/* <div className="grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("profile.fields.usageInsightsLabel")}
        </Text>
        <StatusBadge color="red" className="w-fit">
          {t("general.disabled")}
        </StatusBadge>
      </div> */}
    </Container>
  )
}
