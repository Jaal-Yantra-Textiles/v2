import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom"
import { useVisualFlow, VisualFlow } from "../../../hooks/api/visual-flows"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { visualFlowLoader } from "./loader"
import { VisualFlowGeneralSection } from "../../../components/visual-flows/visual-flow-general-section"
import { VisualFlowEditorSection } from "../../../components/visual-flows/visual-flow-editor-section"
import { VisualFlowExecutionsSection } from "../../../components/visual-flows/visual-flow-executions-section"

const VisualFlowDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const _initialData = useLoaderData() as { flow: VisualFlow } | undefined
  
  // TODO: Use initialData when hook supports it
  const { data: flow, isLoading, isError, error } = useVisualFlow(id!)

  // Show loading skeleton while data is being fetched
  if (isLoading || !flow) {
    return <TwoColumnPageSkeleton mainSections={2} sidebarSections={2} showJSON showMetadata />
  }

  // Handle error state
  if (isError) {
    throw error
  }

  return (
    <TwoColumnPage 
      data={flow}
      showJSON
      showMetadata
      hasOutlet={true}
    >
      <TwoColumnPage.Main>
        <VisualFlowGeneralSection flow={flow} />
        <VisualFlowEditorSection flow={flow} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <VisualFlowExecutionsSection flow={flow} />
      </TwoColumnPage.Sidebar>  
    </TwoColumnPage>
  )
}

export default VisualFlowDetailPage

export async function loader({ params }: LoaderFunctionArgs) {
  return visualFlowLoader({ params })
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `${id}`
  },
}
