import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../components/modals"
import { AddInventoryForm } from "./components/add-inventory-form"

export const DesignAddInventory = () => {
  const { id } = useParams()
  return (
    <RouteFocusModal>
      {id && <AddInventoryForm designId={id} />}
    </RouteFocusModal>
  )
}
