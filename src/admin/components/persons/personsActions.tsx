import React from "react";
import { Action as BaseAction, ActionMenu } from "../common/action-menu";
import { ReactNode } from "react";

type EntityAction<T> = {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  disabledTooltip?: string | ReactNode;
} & (
  | {
      to: (entity: T) => string;
      onClick?: never;
    }
  | {
      onClick: (entity: T) => void;
      to?: never;
    }
);

type ActionsConfig<T> = {
  actions: EntityAction<T>[];
};

type EntityActionsProps<T> = {
  entity: T;
  actionsConfig: ActionsConfig<T>;
  children?: React.ReactNode;
};

function isNavigationAction<T>(
  action: EntityAction<T>,
): action is EntityAction<T> & { to: (entity: T) => string } {
  return "to" in action && typeof action.to === "function";
}

function isClickAction<T>(
  action: EntityAction<T>,
): action is EntityAction<T> & { onClick: (entity: T) => void } {
  return "onClick" in action && typeof action.onClick === "function";
}

export const EntityActions = <T,>({
  entity,
  actionsConfig,
  children,
}: EntityActionsProps<T>) => {
  const mappedActions: BaseAction[] = actionsConfig.actions.map((action) => {
    const { icon, label, disabled, disabledTooltip } = action;

    const baseAction = {
      icon,
      label,
      disabled,
      disabledTooltip,
    };

    if (isNavigationAction(action)) {
      return {
        ...baseAction,
        to: action.to(entity),
      };
    }

    if (isClickAction(action)) {
      return {
        ...baseAction,
        onClick: () => action.onClick(entity),
      };
    }

    // This should never happen due to the type union, but TypeScript requires it
    throw new Error("Invalid action type");
  });

  return (
    <ActionMenu groups={[{ actions: mappedActions }]}>{children}</ActionMenu>
  );
};
