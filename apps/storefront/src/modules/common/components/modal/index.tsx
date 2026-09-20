import { Dialog, Transition } from "@headlessui/react"
import { clx } from "@medusajs/ui"
import React, { Fragment, useEffect, useRef } from "react"

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

/**
 * Can this element absorb a wheel of `delta` right now?
 *
 * Both halves matter: an element with `overflow-y: auto` that is already at
 * the bottom must NOT count, or the panel keeps handing it deltas it cannot
 * use and the gesture dies at the end of the list instead of doing nothing.
 */
const canScroll = (el: HTMLElement, delta: number) => {
  const overflowY = window.getComputedStyle(el).overflowY
  if (overflowY !== "auto" && overflowY !== "scroll") return false
  if (el.scrollHeight <= el.clientHeight) return false
  return delta > 0
    ? Math.ceil(el.scrollTop + el.clientHeight) < el.scrollHeight
    : el.scrollTop > 0
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

    /**
     * `position: fixed` on the body, NOT `overflow: hidden`.
     *
     * Headless UI already sets `html { overflow: hidden }`, and I then added
     * `body { overflow: hidden }` on top. BOTH measured as applied and the
     * page behind STILL scrolled under a real wheel — confirmed by eye, not
     * just by instrument. Taking the body out of flow is the only lock that
     * actually holds, and it is the one that also works on iOS Safari.
     *
     * The scroll position has to be carried on `top` and restored on close,
     * or fixing the body jumps the buyer back to the top of checkout.
     */
    const scrollY = window.scrollY
    const body = document.body
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }

    body.style.position = "fixed"
    body.style.top = `-${scrollY}px`
    body.style.left = "0"
    body.style.right = "0"
    body.style.width = "100%"
    body.style.overflow = "hidden"

    return () => {
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.left = previous.left
      body.style.right = previous.right
      body.style.width = previous.width
      body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [isOpen])

  const panelRef = useRef<HTMLDivElement>(null)

  /**
   * 🔴 The panel is bigger than its scroller, and the difference is dead.
   *
   * Found with a 9-item checkout list, since moved out of this modal and
   * inlined into the summary: a wheel over the middle of the list scrolled
   * it, and a wheel 12px inside the panel's left edge, or over the title row,
   * did NOTHING. The panel is `p-5`, so a 20px ring plus the ~48px title
   * surround any scroller a consumer puts here, and those bands belong to the
   * Panel, which has no overflow. The body is `position: fixed` besides, so
   * the wheel lands on nothing at all — the list reads as
   * unscrollable-except-by-dragging-the-scrollbar, depending only on where
   * the cursor happens to rest.
   *
   * Kept after that list moved out, because it is the shared Modal that is
   * wrong, not the list: the next consumer to put a scroller in here inherits
   * the same dead ring. Forwarded rather than restructured, because the
   * account address cards share this component and moving `p-5` off the Panel
   * would strip their padding.
   *
   * No consumer currently scrolls, so this no-ops until one does.
   *
   * No `preventDefault`: React registers `wheel` passively, and with the body
   * out of flow there is nothing behind this to suppress anyway.
   */
  const forwardWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const panel = panelRef.current
    if (!panel || !event.deltaY) return

    // Already over something that can take it — leave the browser alone,
    // otherwise the list moves twice for one gesture.
    let node = event.target as HTMLElement | null
    while (node && node !== panel.parentElement) {
      if (canScroll(node, event.deltaY)) return
      node = node.parentElement
    }

    const scroller = Array.from(
      panel.querySelectorAll<HTMLElement>("*")
    ).find((el) => canScroll(el, event.deltaY))

    if (scroller) scroller.scrollTop += event.deltaY
  }

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
          Back to the component's original `overflow-y-hidden`.

          I had made this `overflow-y-auto overscroll-contain` while chasing the
          scrolling backdrop. That was the wrong lever — the body being in flow
          was the cause, and it is now `position: fixed`. An extra scroll
          container between the backdrop and the dialog's own list is one more
          thing that can swallow a wheel, so it is gone again.
        */}
        <div className="fixed inset-0 overflow-y-hidden">
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
                ref={panelRef}
                onWheel={forwardWheel}
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
  /**
   * `w-full min-h-0` so a scrollable child can actually bound itself.
   *
   * The Panel is `flex flex-col max-h-[75vh]`. A flex child defaults to
   * `min-height: auto` and refuses to shrink below its content, so a long list
   * pushed past the panel's cap and was clipped by its `overflow: visible`.
   * `w-full` also stops a content-width child being centred, which left dead
   * gutters either side that swallowed the scroll wheel.
   */
  return <div className="flex w-full min-h-0 justify-center">{children}</div>
}

const Footer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className="flex items-center justify-end gap-x-4">{children}</div>
}

Modal.Title = Title
Modal.Description = Description
Modal.Body = Body
Modal.Footer = Footer

export default Modal
