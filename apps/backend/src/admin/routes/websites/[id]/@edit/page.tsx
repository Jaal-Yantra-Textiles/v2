import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import { useWebsite } from "../../../../hooks/api/websites"
import { EditWebsiteForm } from "./components/edit-website-form"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"

const WebsiteEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { website, isLoading, isError, error } = useWebsite(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("websites.edit.header", { defaultValue: "Edit Website" })}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("websites.edit.description", { defaultValue: "Edit website details" })}
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      {!isLoading && website && <EditWebsiteForm website={website} />}
    </RouteDrawer>
  )
}


export default WebsiteEdit;

