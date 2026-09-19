import { Dialog, Transition } from "@headlessui/react"
import { clx } from "@medusajs/ui"
import React, { Fragment, useEffect } from "react"

import { ModalProvider, useModal } from "@lib/context/modal-context"
import X from "@modules/common/icons/x"

type ModalProps = {
  isOpen: boolean
  close: () => void
  size?: "small" | "medium" | "large"
  search?: boolean
  children: React.ReactNode
  'data-testid'?: string
}

const Modal = ({
  isOpen,
  close,
  size = "medium",
  search = false,
  children,
  'data-testid': dataTestId
}: ModalProps) => {
  /**
   * 🔴 Lock the BODY, not just `html`.
   *
   * Headless UI sets `html { overflow: hidden }`, and that was not enough
   * here: `body` is taller than the viewport with `overflow: visible`, so a
   * wheel over the backdrop still scrolled the page. Measured with the dialog
   * open and html already locked — page scrollTop 14 -> 482, the full height
   * of the document. The buyer sees the checkout slide away behind the modal.
   *
   * Restores the previous value rather than assuming "visible", so nesting or
   * a page that sets its own overflow is not clobbered.
   */
  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  return (
    <Transition appear show={isOpen} as={Fragment}>
      {/*
        🔴 `open` is REQUIRED, not redundant with Transition's `show`.
        Headless UI v2 engages its scroll lock and focus trap from the Dialog's
        own open state. Under the v1 pattern — Transition controlling
        visibility, Dialog with only `onClose` — the dialog still RENDERED, so
        it looked fine, while `html`/`body` kept `overflow: visible` and the
        page behind scrolled under the backdrop. Measured: both `visible` with
        a dialog open. This is shared by every modal in the storefront.
      */}
      <Dialog
        as="div"
        open={isOpen}
        className="relative z-[75]"
        onClose={close}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-opacity-75 backdrop-blur-md  h-screen" />
        </Transition.Child>

        {/*
          🔴 `overflow-y-auto overscroll-contain`, not `overflow-y-hidden`.

          A wheel over the backdrop lands HERE. When this container cannot
          scroll, the wheel CHAINS to the page and the backdrop scrolls under
          the dialog — measured: page scrollTop 151 -> 482 with the modal open,
          even though Headless UI had already set `html { overflow: hidden }`.
          Making it scrollable gives the wheel somewhere to go, and
          `overscroll-contain` stops it chaining onward. It also lets a dialog
          taller than the viewport be reached at all.
        */}
        <div className="fixed inset-0 overflow-y-auto overscroll-contain">
          <div
            className={clx(
              "flex min-h-full h-full justify-center p-4 text-center",
              {
                "items-center": !search,
                "items-start": search,
              }
            )}
          >
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel
                data-testid={dataTestId}
                className={clx(
                  "flex flex-col justify-start w-full transform p-5 text-left align-middle transition-all max-h-[75vh] h-fit",
                  {
                    "max-w-md": size === "small",
                    "max-w-xl": size === "medium",
                    "max-w-3xl": size === "large",
                    "bg-transparent shadow-none": search,
                    "bg-white shadow-xl border rounded-rounded": !search,
                  }
                )}
              >
                <ModalProvider close={close}>{children}</ModalProvider>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { close } = useModal()

  return (
    <Dialog.Title className="flex items-center justify-between">
      <div className="text-large-semi">{children}</div>
      <div>
        <button onClick={close} data-testid="close-modal-button">
          <X size={20} />
        </button>
      </div>
    </Dialog.Title>
  )
}

const Description: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <Dialog.Description className="flex text-small-regular text-ui-fg-base items-center justify-center pt-2 pb-4 h-full">
      {children}
    </Dialog.Description>
  )
}

const Body: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className="flex justify-center">{children}</div>
}

const Footer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className="flex items-center justify-end gap-x-4">{children}</div>
}

Modal.Title = Title
Modal.Description = Description
Modal.Body = Body
Modal.Footer = Footer

export default Modal
