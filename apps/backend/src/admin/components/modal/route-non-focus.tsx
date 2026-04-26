import { FocusModal, clx } from "@medusajs/ui";
import { PropsWithChildren, createContext, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RouteModalForm } from "./route-modal-form";
import { useRouteModal } from "./use-route-modal";
import { RouteModalProvider } from "./route-provider";
import { StackedModalProvider } from "./stacked-modal/stacked-modal-provider";

type RouteNonFocusModalContextValue = {
  close: () => void;
  registerBeforeClose: (callback: () => boolean | Promise<boolean>) => void;
 // Added for child prompt state
};

const RouteNonFocusModalContext = createContext<RouteNonFocusModalContextValue | null>(null);

export const useRouteNonFocusModal = () => {
  const context = useContext(RouteNonFocusModalContext);

  if (!context) {
    throw new Error(
      "useRouteNonFocusModal must be used within a RouteNonFocusModal"
    );
  }

  return context;
};

type RouteNonFocusModalProps = PropsWithChildren<{
  prev?: string;
}>;

const Root = ({ prev = "..", children }: RouteNonFocusModalProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [stackedModalOpen, onStackedModalOpen] = useState(false);
  const beforeCloseRef = useRef<(() => boolean | Promise<boolean>) | null>(null);


  useEffect(() => {
    setOpen(true);

    return () => {
      setOpen(false);
      onStackedModalOpen(false);
    };
  }, []);

  const handleClose = async () => {
    if (beforeCloseRef.current) {
      const canClose = await beforeCloseRef.current();
      if (!canClose) {
        return;
      }
    }
    document.body.style.pointerEvents = "auto";
    navigate(prev, { replace: true });
  };

  const handleOpenChange = async (openState: boolean) => {
    if (!openState) {
      await handleClose();
      return;
    }

    setOpen(openState);
  };

  return (
    <RouteNonFocusModalContext.Provider
      value={{
        close: handleClose,
        registerBeforeClose: (callback: () => boolean | Promise<boolean>) => {
          beforeCloseRef.current = callback;
        },

      }}
    >
      {open && (
        <div className="fixed inset-0 bg-black/40 pointer-events-none z-100" />
      )}
      <FocusModal
        open={open}
        onOpenChange={(open) => {
          handleOpenChange(open);
        }}
        modal={false}
      >
        <RouteModalProvider prev={prev}>
          <StackedModalProvider onOpenChange={onStackedModalOpen}>
            <Content stackedModalOpen={stackedModalOpen} >
              {children}
            </Content>
          </StackedModalProvider>
        </RouteModalProvider>
      </FocusModal>
    </RouteNonFocusModalContext.Provider>
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
        "bg-ui-bg-base flex flex-col focus:outline-none",
        
        "border-ui-border-base border shadow-xl",
        {
          "pointer-events-none": stackedModalOpen
          
        }
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
