import { CreateTasksFromTemplates } from "../../../../../components/creates/create-tasks-from-templates";
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal";

export default function Page() {
  return (
    <RouteFocusModal>
        <CreateTasksFromTemplates />        
    </RouteFocusModal>
  
  )
}
