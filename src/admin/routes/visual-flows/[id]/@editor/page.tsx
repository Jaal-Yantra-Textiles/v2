import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useVisualFlow, useUpdateVisualFlow } from "../../../../hooks/api/visual-flows"
import { FlowEditor } from "../../../../components/visual-flows/flow-editor"
import { Text } from "@medusajs/ui"

const VisualFlowEditorPage = () => {
  const { id } = useParams<{ id: string }>()
  const { data: flow, isLoading } = useVisualFlow(id!)
  const updateFlow = useUpdateVisualFlow(id!)

  if (isLoading || !flow) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex items-center justify-center">
          <Text className="text-ui-fg-subtle">Loading editor...</Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-2">
          <Text weight="plus">{flow.name}</Text>
          <Text className="text-ui-fg-subtle">- Visual Editor</Text>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
        <FlowEditor flow={flow} onUpdate={updateFlow.mutate} />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default VisualFlowEditorPage
