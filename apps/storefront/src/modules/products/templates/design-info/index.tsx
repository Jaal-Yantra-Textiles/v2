"use client"

import { Badge, Heading, IconBadge, Popover, Text } from "@medusajs/ui"
import Link from "next/link"
import { CheckCircleSolid, Clock } from "@medusajs/icons"

import { StoreDesign } from "../../../../types/product-design"

type DesignInfoProps = {
  design?: StoreDesign
  designScore?: {
    score: number
    maxScore: number
  }
}

export const DesignInfo = ({ design, designScore }: DesignInfoProps) => {
  if (!design) {
    return null
  }

  const summaryBadges = [
    design.design_type && { label: "Type", value: design.design_type, color: "blue" as const },
    design.status && {
      label: "Stage",
      value: design.status.replace(/_/g, " "),
      color: "grey" as const,
    },
    design.priority && { label: "Priority", value: design.priority, color: "purple" as const },
  ].filter(Boolean) as { label: string; value: string; color: "blue" | "grey" | "purple" }[]

  const partnerNames = design.partners?.map((p) => p.name).filter(Boolean) || []

  const formatTaskLabel = (value: string) =>
    value
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())

  const sharedPopoverContentClass =
    "p-0 w-fit max-w-[min(90vw,20rem)] sm:max-w-xs z-50"

  const renderIcon = (variant: "info" | "help" = "info") => {
    if (variant === "help") {
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="feather feather-help-circle"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 2-3 4"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      )
    }

    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="feather feather-info"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    )
  }

  const InfoPopover = ({
    ariaLabel,
    tooltip,
    iconVariant = "info",
  }: {
    ariaLabel: string
    tooltip: React.ReactNode
    iconVariant?: "info" | "help"
  }) => (
    <Popover>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="rounded-full focus:outline-none focus:ring-2 focus:ring-ui-fg-interactive"
          onClick={(e) => {
            // Ensure click works on touch devices
            e.currentTarget.focus()
          }}
        >
          <IconBadge className="cursor-pointer">{renderIcon(iconVariant)}</IconBadge>
        </button>
      </Popover.Trigger>
      <Popover.Content
        side="bottom"
        align="center"
        sideOffset={8}
        className={sharedPopoverContentClass}
      >
        <div className="rounded-md border border-ui-border-base bg-ui-bg-base shadow-lg">
          {tooltip}
        </div>
      </Popover.Content>
    </Popover>
  )

  const infoTooltip = (
    <div className="flex flex-col gap-y-2 txt-compact-small p-2 max-w-xs">
      <Text className="txt-compact-small-plus font-semibold">
        What is a Design Score?
      </Text>
      <Text>
        The score indicates the completeness of the design information. More
        details mean partners, tasks, and materials are well documented.
      </Text>
      <Link
        href="/what-is-a-design-score"
        className="text-ui-fg-interactive hover:underline"
      >
        Learn more
      </Link>
    </div>
  )

  const timelineTooltip = (
    <div className="flex flex-col gap-y-1 txt-compact-small p-2 max-w-xs">
      <Text className="txt-compact-small-plus font-semibold">
        Activity timeline
      </Text>
      <Text>
        These checkpoints mark when our artists moved through each stage—starting
        work, reworks, and final finishes.
      </Text>
    </div>
  )

  const badgesTooltip = (
    <div className="flex flex-col gap-y-1 txt-compact-small p-2 max-w-xs">
      <Text className="txt-compact-small-plus font-semibold">Badge legend</Text>
      <Text>
        Type tells you the silhouette or category of the piece. Stage shows where the design sits in the workflow.
        Priority highlights how quickly our makers intend to move it through production.
      </Text>
    </div>
  )

  const storyTooltip = (
    <div className="flex flex-col gap-y-2 txt-compact-small p-2 max-w-xs">
      <Text className="txt-compact-small-plus font-semibold">Why Story?</Text>
      <Text>
        This is where we share the inspiration, artisan notes, and intent behind the design so you can feel the journey.
      </Text>
    </div>
  )

  const craftedTooltip = (
    <div className="flex flex-col gap-y-2 txt-compact-small p-2 max-w-xs">
      <Text className="txt-compact-small-plus font-semibold">Who crafted it?</Text>
      <Text>
        Partners listed here are the ateliers, workshops, or craftspeople collaborating with us to bring the piece to life.
      </Text>
    </div>
  )

  return (
    <div className="flex flex-col gap-y-6">
      <header id={`design-info-${design.id}`} className="flex flex-col gap-y-3">
        <div>
          <Text size="small" className="uppercase tracking-wide text-ui-fg-muted">
            Product design
          </Text>
          <Heading level="h3" className="text-xl leading-8 text-ui-fg-base">
            How this piece came together
          </Heading>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {summaryBadges.map((badge) => (
            <Badge key={badge.label} color={badge.color}>
              <span className="font-semibold">{badge.label}:</span> {badge.value}
            </Badge>
          ))}
          {design.tags?.map((tag) => (
            <Badge key={tag} color="green">
              {tag}
            </Badge>
          ))}
          {summaryBadges.length > 0 && (
            <InfoPopover ariaLabel="Badge legend" tooltip={badgesTooltip} iconVariant="help" />
          )}
        </div>

        {designScore && (
          <div className="flex items-center gap-2">
            <Badge color="green">
              Score: {designScore.score}/{designScore.maxScore}
            </Badge>
            <InfoPopover ariaLabel="Design score info" tooltip={infoTooltip} />
          </div>
        )}
      </header>

      {design.description && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
              Story
            </Text>
            <InfoPopover ariaLabel="Story info" tooltip={storyTooltip} />
          </div>
          <Text
            className="text-medium text-ui-fg-subtle whitespace-pre-line leading-7"
            data-testid="design-description"
          >
            {design.description}
          </Text>
        </section>
      )}

      {partnerNames.length > 0 && (
        <section className="space-y-1">
          <div className="flex items-center gap-2">
            <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
              Crafted with
            </Text>
            <InfoPopover ariaLabel="Crafted with info" tooltip={craftedTooltip} />
          </div>
          <Text className="text-small-regular text-ui-fg-subtle">
            {partnerNames.join(", ")}
          </Text>
        </section>
      )}

      {design.color_palette && design.color_palette.length > 0 && (
        <section className="space-y-2">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Color palette
          </Text>
          <div className="flex items-center flex-wrap gap-4">
            {design.color_palette.map((color) => (
              <div
                key={`${color.name}-${color.code}`}
                className="flex items-center gap-x-2"
              >
                <div
                  className="w-8 h-8 rounded-full border border-ui-border-base shadow-inner"
                  style={{ backgroundColor: color.code }}
                />
                <div>
                  <Text className="text-small-regular text-ui-fg-base">
                    {color.name}
                  </Text>
                  <Text className="text-small text-ui-fg-muted uppercase">
                    {color.code}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Activity timeline
          </Text>
          <InfoPopover ariaLabel="Activity timeline info" tooltip={timelineTooltip} />
        </div>
        {design.tasks && design.tasks.length > 0 ? (
          <ol className="space-y-3">
            {design.tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-x-3">
                <div className="mt-1">
                  {task.status === "completed" ? (
                    <CheckCircleSolid className="text-ui-fg-interactive" />
                  ) : (
                    <Clock className="text-ui-fg-muted" />
                  )}
                </div>
                <div>
                  <Text className="text-small-semi text-ui-fg-base">
                    {formatTaskLabel(task.title)}
                  </Text>
                  <Text className="text-small text-ui-fg-muted capitalize">
                    {formatTaskLabel(task.status)}
                  </Text>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Text className="text-small text-ui-fg-muted">
            We haven’t logged activities for this design yet.
          </Text>
        )}
      </section>
    </div>
  )
}


