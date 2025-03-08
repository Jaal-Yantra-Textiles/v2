import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { usePerson } from "../../../../hooks/api/persons"
import { EditPersonGeneralSection } from "../../../../components/edits/edit-person-general-section"

const PersonGeneralEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { person, isLoading, isError, error } = usePerson(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("person.edit.header", { defaultValue: "Edit Person General Section" })}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("person.edit.description", { defaultValue: "Edit person general details" })}
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      {!isLoading && person && <EditPersonGeneralSection person={person} />}
    </RouteDrawer>
  )
}


export default PersonGeneralEdit;

