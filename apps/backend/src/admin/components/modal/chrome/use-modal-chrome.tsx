import { useContext } from "react"

import { ModalChromeContext, type ModalChromeValue } from "./modal-chrome-context"

/**
 * The chrome the surrounding shell wants this form to render with.
 *
 * Throws rather than guessing. A silent fallback to focus-modal parts would
 * put focus-modal markup inside a drawer and "work" visually while breaking
 * the close path — the failure this whole abstraction exists to prevent.
 */
export const useModalChrome = (): ModalChromeValue => {
  const context = useContext(ModalChromeContext)

  if (!context) {
    throw new Error(
      "useModalChrome must be used within a RouteFocusModal, RouteDrawer or StackedFocusModal"
    )
  }

  return context
}
