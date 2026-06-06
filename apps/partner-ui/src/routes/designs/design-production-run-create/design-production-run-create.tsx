import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../components/modals"
import { RunCreateForm } from "./components/run-create-form"

export const DesignProductionRunCreate = () => {
  const { id } = useParams()
  return (
    <RouteFocusModal>
      {id && <RunCreateForm designId={id} />}
    </RouteFocusModal>
  )
}
