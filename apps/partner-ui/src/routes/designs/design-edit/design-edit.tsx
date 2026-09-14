import { Heading } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { RouteDrawer } from "../../../components/modals"
import { usePartnerDesign } from "../../../hooks/api/partner-designs"
import { EditDesignForm } from "./components/edit-design-form"

export const DesignEdit = () => {
  const { t } = useTranslation()
  const { id } = useParams()
  const { design, isLoading, isError, error } = usePartnerDesign(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("partner.designs.edit.heading")}</Heading>
      </RouteDrawer.Header>
      {!isLoading && design && <EditDesignForm design={design} />}
    </RouteDrawer>
  )
}
