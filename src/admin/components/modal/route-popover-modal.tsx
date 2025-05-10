import { clx } from "@medusajs/ui";
import { PropsWithChildren, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RouteModalForm } from "./route-modal-form";
import { useRouteModal } from "./use-route-modal";
import { RouteModalProvider } from "./route-provider";
import { StackedModalProvider } from "./stacked-modal/stacked-modal-provider";
import * as Popover from '@radix-ui/react-popover';
import { X } from "lucide-react";

type RoutePopoverModalProps = PropsWithChildren<{
  prev?: string;
}>;

const Root = ({ prev = "..", children }: RoutePopoverModalProps) => {
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
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Anchor  />
      <Popover.Portal>
        <div />
        <RouteModalProvider prev={prev}>
          <StackedModalProvider onOpenChange={onStackedModalOpen}>
            <Content stackedModalOpen={stackedModalOpen}>{children}</Content>
          </StackedModalProvider>
        </RouteModalProvider>
      </Popover.Portal>
    </Popover.Root>
  );
};

type ContentProps = PropsWithChildren<{
  stackedModalOpen: boolean;
}>;

const Content = ({ stackedModalOpen, children }: ContentProps) => {
  // We don't need to use __internal for this modal type
  useRouteModal();

  return (
    <Popover.Content 
      className={clx(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 gap-4 border bg-ui-bg-base p-6 shadow-xl duration-200 rounded-lg",
        { "!bg-ui-bg-disabled": stackedModalOpen }
      )}
      onOpenAutoFocus={(e) => {
        // Prevent autofocus to avoid focus trapping issues
        e.preventDefault();
      }}
    >
      {children}
    </Popover.Content>
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

const Close = ({ children, className, ...props }: PropsWithChildren<{ className?: string, [key: string]: any }>) => (
  <Popover.Close 
    className={clx("absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none", className)} 
    {...props}
  >
    {children || <X className="h-4 w-4" />}
  </Popover.Close>
);

const Form = RouteModalForm;

/**
 * Popover-based modal that is used to render content on a separate route.
 * 
 * This modal does not trap focus, making it ideal for rich text editors
 * and other interactive components that need to handle their own focus.
 */
export const RoutePopoverModal = Object.assign(Root, {
  Header,
  Title,
  Body,
  Description,
  Footer,
  Close,
  Form,
});
