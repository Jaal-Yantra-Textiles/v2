import { Heading } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { usePartnerDesign } from "../../../hooks/api/partner-designs"
import { EditDesignForm } from "./components/edit-design-form"

export const DesignEdit = () => {
  const { id } = useParams()
  const { design, isLoading, isError, error } = usePartnerDesign(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit design</Heading>
      </RouteDrawer.Header>
      {!isLoading && design && <EditDesignForm design={design} />}
    </RouteDrawer>
  )
}
