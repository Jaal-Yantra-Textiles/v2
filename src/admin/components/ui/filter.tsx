import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@medusajs/ui";
import { ChevronDown } from "@medusajs/icons";

const Filter = PopoverPrimitive.Root;

const FilterTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <PopoverPrimitive.Trigger asChild {...props} ref={ref}>
    <Button
      variant="transparent"
      size="small"
      className="flex items-center gap-2 text-ui-fg-subtle hover:bg-ui-bg-base-hover"
    >
      {children}
      <ChevronDown className="h-4 w-4" />
    </Button>
  </PopoverPrimitive.Trigger>
));
FilterTrigger.displayName = "FilterTrigger";

const FilterContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className="z-50 w-72 rounded-lg border border-ui-border-base bg-ui-bg-base p-4 shadow-dropdown"
      {...props}
    />
  </PopoverPrimitive.Portal>
));
FilterContent.displayName = "FilterContent";

export { Filter, FilterTrigger as Trigger, FilterContent as Content };
