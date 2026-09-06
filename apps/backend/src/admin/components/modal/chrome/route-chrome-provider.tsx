import { PropsWithChildren, useMemo } from "react"

import { useRouteModal } from "../use-route-modal"
import { ModalChromeContext, type ModalChromeValue } from "./modal-chrome-context"

type Parts = Omit<ModalChromeValue, "variant" | "onDone">

/**
 * Publishes a ROUTE shell's chrome (focus modal or drawer) to the forms inside
 * it. `onDone` is that shell's `handleSuccess`, so a form finishing at its own
 * route keeps navigating exactly as it always did.
 *
 * Must be rendered inside `RouteModalProvider` — it reads `handleSuccess`.
 */
export const RouteChromeProvider = ({
  variant,
  parts,
  children,
}: PropsWithChildren<{ variant: "route-focus" | "route-drawer"; parts: Parts }>) => {
  const { handleSuccess } = useRouteModal()

  const value = useMemo<ModalChromeValue>(
    () => ({ variant, ...parts, onDone: handleSuccess }),
    // `parts` is a fresh object each render but its members are module-level
    // constants, so keying on the variant is enough and avoids re-providing on
    // every render of the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, handleSuccess]
  )

  return (
    <ModalChromeContext.Provider value={value}>{children}</ModalChromeContext.Provider>
  )
}

/**
 * Publishes a STACKED shell's chrome. `onDone` closes only this layer, so a
 * form reused inside it leaves the drawer or page underneath standing.
 */
export const StackedChromeProvider = ({
  parts,
  onClose,
  children,
}: PropsWithChildren<{ parts: Parts; onClose: () => void }>) => {
  const value = useMemo<ModalChromeValue>(
    () => ({
      variant: "stacked",
      ...parts,
      // `path` is deliberately ignored: closing a stacked layer must not
      // navigate, or it takes its opener with it.
      onDone: () => onClose(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose]
  )

  return (
    <ModalChromeContext.Provider value={value}>{children}</ModalChromeContext.Provider>
  )
}
