import { useSearchParams } from "react-router-dom"
import { AdminMediaFolder } from "../../../../../../hooks/api/media-folders"
import { createContext, useContext } from "react"
import { FolderMediaGallery } from "../folder-media-gallery/folder-media-gallery"
import { EditFolderMediaForm } from "../edit-folder-media-form/edit-folder-media-form"

export type FolderMediaViewProps = {
  folder: AdminMediaFolder
}

enum View {
  GALLERY = "gallery",
  EDIT = "edit",
}

const getView = (searchParams: URLSearchParams) => {
  const view = searchParams.get("view")
  if (view === View.GALLERY) return View.GALLERY
  return View.EDIT
}

// Context to handle navigation between views
export type FolderMediaViewContextType = {
  goToGallery: () => void
  goToEdit: () => void
}

export const FolderMediaViewContext = createContext<FolderMediaViewContextType | null>(null)

export const useFolderMediaViewContext = () => {
  const context = useContext(FolderMediaViewContext)
  if (!context) {
    throw new Error("useFolderMediaViewContext must be used within a FolderMediaViewContext.Provider")
  }
  return context
}

export const FolderMediaView = ({ folder }: FolderMediaViewProps) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = getView(searchParams)

  const handleGoToView = (view: View) => () => setSearchParams({ view })

  return (
    <FolderMediaViewContext.Provider
      value={{
        goToGallery: handleGoToView(View.GALLERY),
        goToEdit: handleGoToView(View.EDIT),
      }}
    >
      {renderView(view, folder)}
    </FolderMediaViewContext.Provider>
  )
}

const renderView = (view: View, folder: AdminMediaFolder) => {
  switch (view) {
    case View.GALLERY:
      return <FolderMediaGallery folder={folder} />
    case View.EDIT:
      return <EditFolderMediaForm folder={folder} />
  }
  return null
}

export default FolderMediaView
