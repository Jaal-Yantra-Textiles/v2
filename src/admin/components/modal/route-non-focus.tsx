import { FocusModal, clx } from "@medusajs/ui";
import { PropsWithChildren, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RouteModalForm } from "./route-modal-form";
import { useRouteModal } from "./use-route-modal";
import { RouteModalProvider } from "./route-provider";
import { StackedModalProvider } from "./stacked-modal/stacked-modal-provider";


type RouteNonFocusModalProps = PropsWithChildren<{
  prev?: string;
}>;

const Root = ({ prev = "..", children }: RouteNonFocusModalProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [stackedModalOpen, onStackedModalOpen] = useState(false);

  /**
   * Open the modal when the component mounts. This
   * ensures that the entry animation is played.
   */
  useEffect(() => {
    setOpen(true);

    return () => {
      setOpen(false);
      onStackedModalOpen(false);
    };
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      document.body.style.pointerEvents = "auto";
      navigate(prev, { replace: true });
      return;
    }

    setOpen(open);
  };

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 pointer-events-none z-20" />}
      <FocusModal open={open} onOpenChange={handleOpenChange} modal={false}>
        <RouteModalProvider prev={prev}>
          <StackedModalProvider onOpenChange={onStackedModalOpen}>
            <Content stackedModalOpen={stackedModalOpen}>{children}</Content>
          </StackedModalProvider>
        </RouteModalProvider>
      </FocusModal>
    </>
  );
};

type ContentProps = PropsWithChildren<{
  stackedModalOpen: boolean;
}>;

const Content = ({ stackedModalOpen, children }: ContentProps) => {
  const { __internal } = useRouteModal();

  const shouldPreventClose = !__internal.closeOnEscape;

  return (
    
    <FocusModal.Content 
      onEscapeKeyDown={shouldPreventClose ? (e) => e.preventDefault() : undefined}
      onPointerDownOutside={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      className={clx(
        "overflow-visible z-30",
        { "!bg-ui-bg-disabled !inset-x-5 !inset-y-3": stackedModalOpen }
      )}
    >
      {children}
    </FocusModal.Content>
    
  );
};

const Header = FocusModal.Header;
const Title = FocusModal.Title;
const Description = FocusModal.Description;
const Footer = FocusModal.Footer;
const Body = FocusModal.Body;
const Close = FocusModal.Close;
const Form = RouteModalForm;

/**
 * FocusModal that is used to render a form on a separate route.
 *
 * Typically used for forms creating a resource or forms that require
 * a lot of space.
 */
export const RouteNonFocusModal = Object.assign(Root, {
  Header,
  Title,
  Body,
  Description,
  Footer,
  Close,
  Form,
});
