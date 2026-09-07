import { createContext } from "react"
import type { ComponentType } from "react"

/**
 * Which shell a form is being rendered inside.
 *
 * 🔴 Why this exists: every create/edit form in this admin imports
 * `RouteFocusModal` directly and calls `handleSuccess("/some/path")`. That
 * hardcodes TWO things a form has no business knowing — the chrome it is
 * wrapped in, and what closing it means. So a form that works perfectly at its
 * own route cannot be reused inside a `StackedFocusModal`: it renders focus
 * modal markup inside a stacked one, and on success it NAVIGATES, tearing down
 * whatever opened it.
 *
 * That is the concrete blocker to #1847's "edit and create move into the
 * graph". A form asks the context what to render with and what "done" means,
 * and the shell answers.
 */
/**
 * `drawer` is a PLAIN drawer opened by a section's own button, not by a route.
 * It exists so a form does not have to be moved to a route before a second
 * surface can reuse it — the alternative was a second copy of the form living
 * in the section, which is how the trade price ended up with two homes.
 */
export type ModalChromeVariant =
  | "route-focus"
  | "route-drawer"
  | "stacked"
  | "drawer"

export type ModalChromeValue = {
  variant: ModalChromeVariant
  Header: ComponentType<any>
  Title: ComponentType<any>
  Description: ComponentType<any>
  Body: ComponentType<any>
  Footer: ComponentType<any>
  Close: ComponentType<any>
  /**
   * Finish successfully.
   *
   * In a ROUTE shell this navigates (`path`, or back to `prev`). In a STACKED
   * shell it closes only that layer and `path` is ignored — the caller stays
   * exactly where it was, which is the entire point of stacking. A form must
   * therefore never assume a navigation happened.
   */
  onDone: (path?: string) => void
}

export const ModalChromeContext = createContext<ModalChromeValue | null>(null)
