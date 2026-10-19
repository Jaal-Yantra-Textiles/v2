"use client"

import { useState } from "react"
import { Badge, Button, Heading, IconBadge, Input, Popover, Text } from "@medusajs/ui"
import { LockClosedSolid } from "@medusajs/icons"

import { shareProductionStory } from "@lib/data/designs"

import { StoreDesign } from "../../../../types/product-design"
import type { JourneyStep } from "../../components/production-story/lib"
import { condenseJourney, formatStoryDate } from "../../components/production-story/lib"

type DesignInfoProps = {
  design?: StoreDesign
  /**
   * The public TEASER of the production-run lifecycle: first and last step
   * only. When present it replaces the v1 design.tasks timeline; v1-only
   * designs (no production runs) keep a condensed task timeline.
   */
  activityTimeline?: JourneyStep[]
  /** Steps between the first and the last, withheld until a shopper asks. */
  hiddenSteps?: number
  productTitle?: string | null
  productHandle?: string | null
}

export const DesignInfo = ({
  design,
  activityTimeline,
  hiddenSteps = 0,
  productTitle,
  productHandle,
}: DesignInfoProps) => {
  const [askOpen, setAskOpen] = useState(false)

  if (!design) {
    return null
  }

  // Stage, priority and the design score are our workflow, not the buyer's
  // business: only the type is shown.
  const summaryBadges = [
    design.design_type && { label: "Type", value: design.design_type, color: "blue" as const },
  ].filter(Boolean) as { label: string; value: string; color: "blue" }[]

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

  const timelineTooltip = (
    <div className="flex flex-col gap-y-1 txt-compact-small p-2 max-w-xs">
      <Text className="txt-compact-small-plus font-semibold">
        Activity timeline
      </Text>
      <Text>
        When work started and when it was finished. Leave your email to get
        every step in between, the people who made it and what went into it.
      </Text>
    </div>
  )

  const badgesTooltip = (
    <div className="flex flex-col gap-y-1 txt-compact-small p-2 max-w-xs">
      <Text className="txt-compact-small-plus font-semibold">Badge legend</Text>
      <Text>
        Type tells you the silhouette or category of the piece.
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

  // v2 runs when there are any; else the v1 task list, condensed the same way.
  const taskSteps: JourneyStep[] = (design.tasks ?? []).map((task) => ({
    id: task.id,
    label: formatTaskLabel(task.title),
    date: null,
    done: task.status === "completed",
  }))
  const { steps: timelineSteps, hiddenSteps: hidden } =
    activityTimeline && activityTimeline.length > 0
      ? { steps: activityTimeline, hiddenSteps }
      : condenseJourney(taskSteps)

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
        {timelineSteps.length > 0 ? (
          <ol className="flex flex-col">
            {timelineSteps.map((step, i) => {
              const last = i === timelineSteps.length - 1
              const date = formatStoryDate(step.date)
              return (
                <li key={step.id} className="flex flex-col">
                  <div className="flex gap-x-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-ui-bg-base ${
                          step.done ? "bg-ui-fg-interactive" : "bg-ui-border-strong"
                        }`}
                      />
                      {!last && <span className="w-px grow bg-ui-border-base" />}
                    </div>
                    <div className={`flex flex-col ${last ? "" : "pb-4"}`}>
                      <Text className="text-small-semi text-ui-fg-base">{step.label}</Text>
                      {date && <Text className="text-small text-ui-fg-muted">{date}</Text>}
                    </div>
                  </div>
                  {i === 0 && hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setAskOpen(true)}
                      className="flex gap-x-3 pb-4 text-left"
                      aria-label={`Show ${hidden} more steps`}
                      data-testid="timeline-hidden-steps"
                    >
                      <span className="flex w-2.5 justify-center text-ui-fg-muted leading-none">
                        ⋮
                      </span>
                      <Text className="text-small text-ui-fg-muted hover:text-ui-fg-interactive">
                        ··· {hidden} more {hidden === 1 ? "step" : "steps"}
                      </Text>
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        ) : (
          <Text className="text-small text-ui-fg-muted">
            We haven’t logged activities for this design yet.
          </Text>
        )}

        <StoryRequest
          designId={design.id}
          productTitle={productTitle}
          productHandle={productHandle}
          open={askOpen}
          onOpen={() => setAskOpen(true)}
        />
      </section>
    </div>
  )
}



const StoryRequest = ({
  designId,
  productTitle,
  productHandle,
  open,
  onOpen,
}: {
  designId: string
  productTitle?: string | null
  productHandle?: string | null
  open: boolean
  onOpen: () => void
}) => {
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle")

  if (state === "sent") {
    return (
      <Text className="text-small text-ui-fg-subtle" data-testid="story-request-sent">
        Sent. The full making story is on its way to {email}.
      </Text>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-x-2 text-small-semi text-ui-fg-interactive hover:underline"
        data-testid="story-request-open"
      >
        <LockClosedSolid />
        Get the full making story
      </button>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState("sending")
    const result = await shareProductionStory({
      designId,
      email: email.trim(),
      productTitle: productTitle ?? undefined,
      productHandle: productHandle ?? undefined,
      productUrl: typeof window !== "undefined" ? window.location.href : undefined,
    })
    setState(result.sent ? "sent" : "error")
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-y-2" data-testid="story-request-form">
      <Text className="text-small text-ui-fg-subtle">
        Every step, the people who made it, the materials and the energy it took.
        We email it to you once; no newsletter.
      </Text>
      <div className="flex gap-x-2">
        <Input
          type="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Your email"
        />
        <Button type="submit" variant="secondary" isLoading={state === "sending"}>
          Send
        </Button>
      </div>
      {state === "error" && (
        <Text className="text-small text-ui-fg-error">
          We couldn’t send it just now. Please try again in a moment.
        </Text>
      )}
    </form>
  )
}
