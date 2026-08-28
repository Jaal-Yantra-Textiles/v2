import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modals"
import { useMe } from "../../../../hooks/api/users"
import { usePartnerPaymentMethod } from "../../../../hooks/api/partner-payment-methods"
import { PaymentMethodEditForm } from "./components/payment-method-edit-form"

export const SettingsPaymentsEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()
  const { user } = useMe()
  const partnerId = user?.partner_id

  const { paymentMethod, isPending, isError, error } = usePartnerPaymentMethod(
    partnerId,
    id
  )

  const ready = !isPending && !!paymentMethod

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("partner.payments.edit.heading")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("partner.payments.edit.description")}
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      {ready && <PaymentMethodEditForm paymentMethod={paymentMethod} />}
    </RouteDrawer>
  )
}