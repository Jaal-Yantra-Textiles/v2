import { RouteFocusModal } from "../../components/modal/route-focus-modal"
import GeneralChat from "../../components/ai/general-chat"
import { useSearchParams } from "react-router-dom"

const ChatsModalRoute = () => {
  const [params] = useSearchParams()
  const entity = params.get("entity") || undefined
  const entityId = params.get("entityId") || undefined

  return (
    <RouteFocusModal>
      <GeneralChat entity={entity} entityId={entityId as string | undefined} />
    </RouteFocusModal>
  )
}

export default ChatsModalRoute