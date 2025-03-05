import { useSearchParams } from "react-router-dom"
import { AdminDesign } from "../../../../../../hooks/api/designs"
import { DesignMediaGallery } from "../design-media-gallery"
import { EditDesignMediaForm } from "../edit-design-media-form"
import { createContext, useContext } from "react"

type DesignMediaViewProps = {
  design: AdminDesign
}

enum View {
  GALLERY = "gallery",
  EDIT = "edit",
}

const getView = (searchParams: URLSearchParams) => {
  const view = searchParams.get("view")
  if (view === View.EDIT) {
    return View.EDIT
  }

  return View.GALLERY
}

// Context to handle navigation between views
type DesignMediaViewContextType = {
  goToGallery: () => void
  goToEdit: () => void
}

export const DesignMediaViewContext = createContext<DesignMediaViewContextType | null>(null)

export const useDesignMediaViewContext = () => {
  const context = useContext(DesignMediaViewContext)
  if (!context) {
    throw new Error("useDesignMediaViewContext must be used within a DesignMediaViewProvider")
  }
  return context
}

export const DesignMediaView = ({ design }: DesignMediaViewProps) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = getView(searchParams)

  const handleGoToView = (view: View) => {
    return () => {
      setSearchParams({ view })
    }
  }

  return (
    <DesignMediaViewContext.Provider
      value={{
        goToGallery: handleGoToView(View.GALLERY),
        goToEdit: handleGoToView(View.EDIT),
      }}
    >
      {renderView(view, design)}
    </DesignMediaViewContext.Provider>
  )
}

const renderView = (view: View, design: AdminDesign) => {
  switch (view) {
    case View.GALLERY:
      return <DesignMediaGallery design={design} />
    case View.EDIT:
      return <EditDesignMediaForm design={design} />
  }
}

export default DesignMediaView