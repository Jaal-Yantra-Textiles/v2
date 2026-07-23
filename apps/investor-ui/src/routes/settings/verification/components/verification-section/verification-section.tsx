import { PencilSquare } from "@medusajs/icons"
import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { ActionMenu } from "../../../../../components/common/action-menu"

type InvestorData = {
  id: string
  name: string
  country_code?: string | null
  pan_number?: string | null
  aadhar_number?: string | null
  international_id_number?: string | null
  id_type?: string | null
}

type VerificationSectionProps = {
  investor: InvestorData
}

const maskId = (value: string | null | undefined): string => {
  if (!value) return "-"
  if (value.length <= 4) return value
  return value.slice(0, 2) + "••••" + value.slice(-2)
}

export const VerificationSection = ({ investor }: VerificationSectionProps) => {
  const { t } = useTranslation()

  const isIndia = investor.country_code?.toUpperCase() === "IN"
  const hasPan = !!investor.pan_number
  const hasAadhar = !!investor.aadhar_number
  const hasInternational = !!investor.international_id_number
  const hasAny = hasPan || hasAadhar || hasInternational

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>{t("verification.domain")}</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            {t("verification.description")}
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: t("actions.edit"),
                  to: "edit",
                  icon: <PencilSquare />,
                },
              ],
            },
          ]}
        />
      </div>
      {!hasAny && (
        <div className="px-6 py-4">
          <Text className="text-ui-fg-muted" size="small">
            {t("verification.noData")}
          </Text>
        </div>
      )}
      {isIndia && (
        <>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("verification.panCard")}
            </Text>
            <div className="flex items-center gap-x-2">
              <Text size="small" leading="compact">
                {hasPan ? maskId(investor.pan_number) : "-"}
              </Text>
              {hasPan && (
                <Badge color="green" size="small">
                  {t("verification.provided")}
                </Badge>
              )}
            </div>
          </div>
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("verification.aadharCard")}
            </Text>
            <div className="flex items-center gap-x-2">
              <Text size="small" leading="compact">
                {hasAadhar ? maskId(investor.aadhar_number) : "-"}
              </Text>
              {hasAadhar && (
                <Badge color="green" size="small">
                  {t("verification.provided")}
                </Badge>
              )}
            </div>
          </div>
        </>
      )}
      {!isIndia && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {t("verification.internationalId")}
          </Text>
          <div className="flex items-center gap-x-2">
            <Text size="small" leading="compact">
              {hasInternational
                ? maskId(investor.international_id_number)
                : "-"}
            </Text>
            {hasInternational && (
              <Badge color="green" size="small">
                {t("verification.provided")}
              </Badge>
            )}
          </div>
        </div>
      )}
    </Container>
  )
}
