import { clx } from "@medusajs/ui";
import { PropsWithChildren, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RouteModalForm } from "./route-modal-form";
import { useRouteModal } from "./use-route-modal";
import { RouteModalProvider } from "./route-provider";
import { StackedModalProvider } from "./stacked-modal/stacked-modal-provider";
import { X } from "lucide-react";

type SimpleModalProps = PropsWithChildren<{
  prev?: string;
}>;

const Root = ({ prev = "..", children }: SimpleModalProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [stackedModalOpen, onStackedModalOpen] = useState(false);

  /**
   * Open the modal when the component mounts. This
   * ensures that the entry animation is played.
   */
  useEffect(() => {
    setOpen(true);
    // Prevent body scrolling when modal is open
    document.body.style.overflow = "hidden";

    return () => {
      setOpen(false);
      onStackedModalOpen(false);
      // Restore body scrolling when modal is closed
      document.body.style.overflow = "";
    };
  }, []);

  const handleClose = () => {
    document.body.style.pointerEvents = "auto";
    navigate(prev, { replace: true });
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 z-50" 
        aria-hidden="true" 
        onClick={handleClose}
      />
      
      {/* Modal content */}
      <RouteModalProvider prev={prev}>
        <StackedModalProvider onOpenChange={onStackedModalOpen}>
          <Content stackedModalOpen={stackedModalOpen} onClose={handleClose}>
            {children}
          </Content>
        </StackedModalProvider>
      </RouteModalProvider>
    </div>
  );
};

type ContentProps = PropsWithChildren<{
  stackedModalOpen: boolean;
  onClose: () => void;
}>;

const Content = ({ stackedModalOpen, children, onClose }: ContentProps) => {
  // We don't need to use __internal for this modal type
  useRouteModal();

  return (
    <div 
      className={clx(
        "relative z-50 w-full max-w-3xl mx-auto my-8 bg-ui-bg-base p-6 shadow-xl rounded-lg border",
        { "!bg-ui-bg-disabled": stackedModalOpen }
      )}
      onClick={(e) => e.stopPropagation()} // Prevent clicks from closing the modal
    >
      {children}
      
      {/* Close button in the top right */}
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 text-ui-fg-subtle hover:text-ui-fg-base"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

// Create components that mimic the FocusModal structure
const Header = ({ children, className, ...props }: PropsWithChildren<{ className?: string, [key: string]: any }>) => (
  <div className={clx("flex flex-col gap-1 py-2 mb-4 border-b", className)} {...props}>
    {children}
  </div>
);

const Title = ({ children, className, ...props }: PropsWithChildren<{ className?: string, [key: string]: any }>) => (
  <h2 className={clx("text-xl font-semibold", className)} {...props}>
    {children}
  </h2>
);

const Description = ({ children, className, ...props }: PropsWithChildren<{ className?: string, [key: string]: any }>) => (
  <p className={clx("text-sm text-ui-fg-subtle", className)} {...props}>
    {children}
  </p>
);

const Body = ({ children, className, ...props }: PropsWithChildren<{ className?: string, [key: string]: any }>) => (
  <div className={clx("flex-1 overflow-auto", className)} {...props}>
    {children}
  </div>
);

const Footer = ({ children, className, ...props }: PropsWithChildren<{ className?: string, [key: string]: any }>) => (
  <div className={clx("flex items-center justify-end gap-2 pt-4 mt-4 border-t", className)} {...props}>
    {children}
  </div>
);

const Close = ({ children, className, onClose, ...props }: PropsWithChildren<{ className?: string, onClose?: () => void, [key: string]: any }>) => {
  const routeModal = useRouteModal();
  
  const handleClick = () => {
    if (onClose) {
      onClose();
    } else {
      // Use the handleSuccess function from the context
      routeModal.handleSuccess();
    }
  };
  
  return (
    <button 
      className={clx("rounded-sm opacity-70 hover:opacity-100 focus:outline-none", className)} 
      onClick={handleClick}
      {...props}
    >
      {children || <X className="h-4 w-4" />}
    </button>
  );
};

const Form = RouteModalForm;

/**
 * Simple modal that is used to render content on a separate route.
 * 
 * This modal does not trap focus, making it ideal for rich text editors
 * and other interactive components that need to handle their own focus.
 */
export const SimpleModal = Object.assign(Root, {
  Header,
  Title,
  Body,
  Description,
  Footer,
  Close,
  Form,
});
