import { DropdownMenu, IconButton, clx } from "@medusajs/ui";

import { EllipsisHorizontal } from "@medusajs/icons";
import { PropsWithChildren, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConditionalTooltip } from "./conditional-tooltip";

export type Action = {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  /**
   * Optional tooltip to display when a disabled action is hovered.
   */
  disabledTooltip?: string | ReactNode;
} & (
  | {
      to: string;
      onClick?: never;
    }
  | {
      onClick: () => void;
      to?: never;
    }
);

export type ActionGroup = {
  actions: Action[];
};

type ActionMenuProps = PropsWithChildren<{
  groups: ActionGroup[];
}>;

export const ActionMenu = ({ groups, children }: ActionMenuProps) => {
  const inner = children ?? (
    /**
     * 🔑 The trigger needs a NAME. Its only content is an icon, so without
     * `aria-label` it has no accessible name at all — a screen reader announces
     * "button", and nothing selecting by role and name can find it. That is not
     * a test-only problem: this menu is where the destructive actions live
     * across the whole admin, so the one control that deletes things was the
     * one control nobody could address by name.
     */
    <IconButton
      size="small"
      variant="transparent"
      aria-label="Open actions menu"
    >
      <EllipsisHorizontal />
    </IconButton>
  );

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>{inner}</DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {groups.map((group, index) => {
          if (!group.actions.length) {
            return null;
          }

          const isLast = index === groups.length - 1;

          return (
            <DropdownMenu.Group key={index}>
              {group.actions.map((action, index) => {
                const Wrapper = action.disabledTooltip
                  ? ({ children }: { children: ReactNode }) => (
                      <ConditionalTooltip
                        showTooltip={action.disabled}
                        content={action.disabledTooltip}
                        side="right"
                      >
                        <div>{children}</div>
                      </ConditionalTooltip>
                    )
                  : "div";

                if (action.onClick) {
                  return (
                    <Wrapper key={index}>
                      <DropdownMenu.Item
                        disabled={action.disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          action.onClick();
                        }}
                        className={clx(
                          "[&_svg]:text-ui-fg-subtle flex items-center gap-x-2",
                          {
                            "[&_svg]:text-ui-fg-disabled": action.disabled,
                          },
                        )}
                      >
                        {action.icon}
                        <span>{action.label}</span>
                      </DropdownMenu.Item>
                    </Wrapper>
                  );
                }

                return (
                  <Wrapper key={index}>
                    <DropdownMenu.Item
                      className={clx(
                        "[&_svg]:text-ui-fg-subtle flex items-center gap-x-2",
                        {
                          "[&_svg]:text-ui-fg-disabled": action.disabled,
                        },
                      )}
                      asChild
                      disabled={action.disabled}
                    >
                      <Link to={action.to} onClick={(e) => e.stopPropagation()}>
                        {action.icon}
                        <span>{action.label}</span>
                      </Link>
                    </DropdownMenu.Item>
                  </Wrapper>
                );
              })}
              {!isLast && <DropdownMenu.Separator />}
            </DropdownMenu.Group>
          );
        })}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};
