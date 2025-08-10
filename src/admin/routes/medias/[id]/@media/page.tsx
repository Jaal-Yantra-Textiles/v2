import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useMediaFolderDetail } from "../../../../hooks/api/media-folders/use-media-folder-detail"
import { FolderMediaView } from "./components/folder-media-view/folder-media-view"

const MediaFolderMedia = () => {
  const { id } = useParams()

  const { folder, isLoading, isError, error } = useMediaFolderDetail(id!)
  const ready = !isLoading && !!folder

  if (isError) {
    throw error
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Folder Media</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">Manage folder media files</span>
      </RouteFocusModal.Description>
      {ready && <FolderMediaView folder={folder!} />}
    </RouteFocusModal>
  )
}

export default MediaFolderMedia
