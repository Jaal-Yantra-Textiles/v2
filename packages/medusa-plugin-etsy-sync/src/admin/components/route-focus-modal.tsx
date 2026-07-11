import { FocusModal } from "@medusajs/ui"
import { PropsWithChildren, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

/**
 * Minimal route-driven FocusModal for plugin admin routes.
 *
 * Mirrors the Medusa dashboard's `RouteFocusModal` (which isn't exported for
 * plugins) without the form / stacked-modal / provider machinery — a full-page
 * FocusModal that opens on mount (so the entry animation plays) and navigates
 * back to `prev` on close, so the route itself drives open/closed state.
 */
type RouteFocusModalProps = PropsWithChildren<{
  /** Where to navigate on close. Defaults to the parent route. */
  prev?: string
}>

const Root = ({ prev = "..", children }: RouteFocusModalProps) => {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  // Open on mount so the entry animation plays; reset on unmount.
  useEffect(() => {
    setOpen(true)
    return () => setOpen(false)
  }, [])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      document.body.style.pointerEvents = "auto"
      navigate(prev, { replace: true })
      return
    }
    setOpen(next)
  }

  return (
    <FocusModal open={open} onOpenChange={handleOpenChange}>
      <FocusModal.Content className="flex flex-col">{children}</FocusModal.Content>
    </FocusModal>
  )
}

export const RouteFocusModal = Object.assign(Root, {
  Header: FocusModal.Header,
  Title: FocusModal.Title,
  Description: FocusModal.Description,
  Body: FocusModal.Body,
  Footer: FocusModal.Footer,
  Close: FocusModal.Close,
})
