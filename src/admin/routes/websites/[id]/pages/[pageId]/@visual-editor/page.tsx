import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../../../components/modal/route-focus-modal"
import { usePage } from "../../../../../../hooks/api/pages"
import { useBlocks } from "../../../../../../hooks/api/blocks"
import { VisualPageEditor } from "../../../../../../components/visual-editor/visual-page-editor"
import { Text } from "@medusajs/ui"

const VisualEditorPage = () => {
  const { id: websiteId, pageId } = useParams<{ id: string; pageId: string }>()
  const { page, isLoading: pageLoading } = usePage(websiteId!, pageId!)
  const { blocks, isLoading: blocksLoading } = useBlocks(websiteId!, pageId!)

  const isLoading = pageLoading || blocksLoading

  if (isLoading || !page) {
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
          <Text weight="plus">{page.title}</Text>
          <Text className="text-ui-fg-subtle">- Visual Editor</Text>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
        <VisualPageEditor
          websiteId={websiteId!}
          pageId={pageId!}
          page={page}
          blocks={blocks || []}
        />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default VisualEditorPage
