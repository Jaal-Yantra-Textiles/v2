import { FocusModal, clx } from "@medusajs/ui"
import {
  ComponentPropsWithoutRef,
  PropsWithChildren,
  forwardRef,
  useEffect,
} from "react"
import { useStackedModal } from "./use-stacked-modal"


type StackedFocusModalProps = PropsWithChildren<{
  /**
   * A unique identifier for the modal. This is used to differentiate stacked modals,
   * when multiple stacked modals are registered to the same parent modal.
   */
  id: string
  /**
   * An optional callback that is called when the modal is opened or closed.
   */
  onOpenChangeCallback?: (open: boolean) => void
}>

/**
 * A stacked modal that can be rendered above a parent modal.
 */
export const Root = ({
  id,
  onOpenChangeCallback,
  children,
}: StackedFocusModalProps) => {
  const { register, unregister, getIsOpen, setIsOpen } = useStackedModal()

  useEffect(() => {
    register(id)

    return () => unregister(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpenChange = (open: boolean) => {
    setIsOpen(id, open)
    onOpenChangeCallback?.(open)
  }

  return (
    <FocusModal open={getIsOpen(id)} onOpenChange={handleOpenChange}>
      {children}
    </FocusModal>
  )
}

const Close = FocusModal.Close
Close.displayName = "StackedFocusModal.Close"

const Header = FocusModal.Header
Header.displayName = "StackedFocusModal.Header"

const Body = FocusModal.Body
Body.displayName = "StackedFocusModal.Body"

const Trigger = FocusModal.Trigger
Trigger.displayName = "StackedFocusModal.Trigger"

const Footer = FocusModal.Footer
Footer.displayName = "StackedFocusModal.Footer"

const Title = FocusModal.Title
Title.displayName = "StackedFocusModal.Title"

const Description = FocusModal.Description
Description.displayName = "StackedFocusModal.Description"

const Content = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof FocusModal.Content>
>(({ className, ...props }, ref) => {
  return (
    <FocusModal.Content
      ref={ref}
      className={clx("!top-6", className)}
      overlayProps={{
        className: "bg-transparent",
      }}
      {...props}
    />
  )
})
Content.displayName = "StackedFocusModal.Content"

export const StackedFocusModal = Object.assign(Root, {
  Close,
  Header,
  Body,
  Content,
  Trigger,
  Footer,
  Description,
  Title,
})