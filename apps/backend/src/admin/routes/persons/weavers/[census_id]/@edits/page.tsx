import { useParams } from "react-router-dom"

import { WeaverEditsForm } from "../../../../../components/persons/weaver-edits-form"

const WeaverEditsDrawer = () => {
  const { census_id } = useParams()

  return <WeaverEditsForm censusId={census_id!} />
}

export default WeaverEditsDrawer