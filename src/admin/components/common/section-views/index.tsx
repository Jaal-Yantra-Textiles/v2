import { Badge, Container, Heading, Text, Tooltip } from "@medusajs/ui";
import { ReactNode } from "react";
import { Action, ActionMenu } from "../action-menu";

export type ActionGroup = {
  actions: Action[];
};

export type CommonField = {
  label: string;
} & (
  | {
      value: ReactNode;
      badge?: undefined;
      badges?: undefined;
      link?: undefined;
    }
  | {
      value?: undefined;
      badge: {
        value: string;
        color?: "green" | "red" | "blue" | "orange" | "grey" | "purple";
      };
      badges?: undefined;
      link?: undefined;
    }
  | {
      value?: undefined;
      badge?: undefined;
      badges: {
        value: string;
        color?: "green" | "red" | "blue" | "orange" | "grey" | "purple";
      }[];
      link?: undefined;
    }
  | {
      value?: undefined;
      badge?: undefined;
      badges?: undefined;
      link: {
        href: string;
        label?: string;
      };
    }
);

type CommonSectionProps = {
  title?: string;
  description?: string;
  fields: CommonField[];
  actionGroups?: ActionGroup[];
};

export const CommonSection = ({
  title,
  description,
  fields,
  actionGroups,
}: CommonSectionProps) => {
  return (
    <Container className="divide-y p-0">
      {(title || actionGroups) && (
        <div className="flex items-center justify-between px-6 py-4">
          {title && (
            <div>
              <Heading level="h2">{title}</Heading>
              {description && (
                <Text className="text-ui-fg-subtle mt-1">{description}</Text>
              )}
            </div>
          )}
          {actionGroups && <ActionMenu groups={actionGroups} />}
        </div>
      )}

      {fields.map((field, index) => (
        <div
          key={`${field.label}-${index}`}
          className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4"
        >
          <Text size="small" leading="compact" weight="plus">
            {field.label}
          </Text>
          <div>
            {field.badge ? (
              <Badge color={field.badge.color || "grey"}>{field.badge.value}</Badge>
            ) : field.badges ? (
              <div className="flex gap-x-4">
                {field.badges.map((badge, badgeIndex) => (
                  <Badge
                    key={`${badge.value}-${badgeIndex}`}
                    color={badge.color || "grey"}
                  >
                    {badge.value}
                  </Badge>
                ))}
              </div>
            ) : field.link ? (
              <a
                href={field.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover hover:underline inline-flex items-center gap-1"
              >
                <Tooltip content={field.link.href} side="top">
                  <Text size="small" leading="compact" className="truncate max-w-[250px]">
                    {field.link.label || "View Link"}
                  </Text>
                </Tooltip>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-shrink-0"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            ) : (
              <Text size="small" leading="compact">
                {field.value || "-"}
              </Text>
            )}
          </div>
        </div>
      ))}
    </Container>
  );
};

type BadgeGroupField = {
  label: string;
  badges: {
    value: string;
    color?: "green" | "red" | "blue" | "orange" | "grey" | "purple";
  }[];
};

type BadgeGroupSectionProps = {
  title?: string;
  description?: string;
  fields: BadgeGroupField[];
  actionGroups?: ActionGroup[];
};

export const BadgeGroupSection = ({
  title,
  description,
  fields,
  actionGroups,
}: BadgeGroupSectionProps) => {
  return (
    <Container className="divide-y p-0">
      {(title || actionGroups) && (
        <div className="flex items-center justify-between px-6 py-4">
          {title && (
            <div>
              <Heading level="h2">{title}</Heading>
              {description && (
                <Text className="text-ui-fg-subtle mt-1">{description}</Text>
              )}
            </div>
          )}
          {actionGroups && <ActionMenu groups={actionGroups} />}
        </div>
      )}

      {fields.map((field, index) => (
        <div
          key={`${field.label}-${index}`}
          className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4"
        >
          <Text size="small" leading="compact" weight="plus">
            {field.label}
          </Text>
          <div className="flex gap-x-4">
            {field.badges.map((badge, badgeIndex) => (
              <Badge
                key={`${badge.value}-${badgeIndex}`}
                color={badge.color || "grey"}
              >
                {badge.value}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </Container>
  );
};

type EmptyStateProps = {
  title?: string;
  description?: string;
  message: string;
  actionGroups?: ActionGroup[];
};

export const EmptyStateSection = ({
  title,
  description,
  message,
  actionGroups,
}: EmptyStateProps) => {
  return (
    <Container className="divide-y p-0">
      {(title || actionGroups) && (
        <div className="flex items-center justify-between px-6 py-4">
          {title && (
            <div>
              <Heading level="h2">{title}</Heading>
              {description && (
                <Text className="text-ui-fg-subtle mt-1">{description}</Text>
              )}
            </div>
          )}
          {actionGroups && <ActionMenu groups={actionGroups} />}
        </div>
      )}
      <div className="px-6 py-4">
        <Text className="text-ui-fg-subtle" size="small" leading="compact">
          {message}
        </Text>
      </div>
    </Container>
  );
};
