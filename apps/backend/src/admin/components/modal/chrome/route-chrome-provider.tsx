import { PropsWithChildren, useMemo, useRef } from "react"

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
  /**
   * 🔴 `onClose` is a FRESH ARROW on every render of `StackedFocusModal.Root`
   * (`onClose={() => handleOpenChange(false)}`), so keying the memo on it
   * re-provided this context on every render of the layer — and that turned a
   * one-shot `register()` into an infinite remount loop:
   *
   *   a thumbnail mounts -> `register(useId())` -> `StackedModalProvider`
   *   setState -> every `useStackedModal()` consumer re-renders, including the
   *   Root above -> new `onClose` -> new chrome value -> every
   *   `useModalChrome()` consumer re-renders, including the form inside ->
   *   its column defs are rebuilt, and TanStack renders a `cell` FUNCTION as
   *   the element type, so a new function identity UNMOUNTS and remounts every
   *   cell -> the thumbnail mounts again with a new id -> round again.
   *
   * Measured at ~7 cycles/second in the design graph: the inventory picker's
   * image-preview button was destroyed and rebuilt faster than a click could
   * land on it, which read as "clicking the photo does nothing". The same table
   * on `/designs/:id/addinv` was fine because `RouteChromeProvider` above keys
   * its memo on values that do not churn.
   *
   * The ref keeps `onDone` calling the CURRENT `onClose` — the identity is what
   * had to stop moving, not the behaviour.
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const value = useMemo<ModalChromeValue>(
    () => ({
      variant: "stacked",
      ...parts,
      // `path` is deliberately ignored: closing a stacked layer must not
      // navigate, or it takes its opener with it.
      onDone: () => onCloseRef.current(),
    }),
    // `parts` is a fresh object each render but its members are module-level
    // constants — the same reasoning `RouteChromeProvider` above documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return (
    <ModalChromeContext.Provider value={value}>{children}</ModalChromeContext.Provider>
  )
}
