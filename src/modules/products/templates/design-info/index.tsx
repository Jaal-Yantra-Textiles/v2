import { Badge, Heading, IconBadge, Text, Tooltip, TooltipProvider } from "@medusajs/ui"
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
        <div className="flex flex-wrap gap-2">
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
        </div>

        {designScore && (
          <div className="flex items-center gap-2">
            <Badge color="green">
              Score: {designScore.score}/{designScore.maxScore}
            </Badge>
            <TooltipProvider>
              <Tooltip content={infoTooltip}>
                <IconBadge className="cursor-pointer">
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
                </IconBadge>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </header>

      {design.description && (
        <section className="space-y-2">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Story
          </Text>
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
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Crafted with
          </Text>
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
          <TooltipProvider>
            <Tooltip content={timelineTooltip}>
              <IconBadge className="cursor-pointer">
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
              </IconBadge>
            </Tooltip>
          </TooltipProvider>
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


