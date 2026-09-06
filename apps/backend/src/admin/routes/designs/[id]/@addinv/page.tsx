import { useParams } from "react-router-dom"

import { DesignInventoryTable } from "../../../../components/designs/design-inventory-table"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

/**
 * The SHELL for the inventory picker. The table used to open its own focus
 * modal; the root lives here now so the same component can be rendered inside
 * the design graph's stacked modal without nesting two of them.
 */
const AddDesignInventoryPage = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <DesignInventoryTable designId={id!} />
    </RouteFocusModal>
  )
}

export default AddDesignInventoryPage
