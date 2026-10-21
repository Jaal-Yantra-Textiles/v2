"use client"

import { useState } from "react"
import { Button, Heading, Input, Text } from "@medusajs/ui"
import { LockClosedSolid } from "@medusajs/icons"

import { shareProductionStory } from "@lib/data/designs"
import type { ProductionStory } from "@lib/data/designs"

import { StoreDesign } from "../../../../types/product-design"
import type { JourneyStep } from "../../components/production-story/lib"
import {
  condenseJourney,
  craftedBy,
  formatStoryDate,
  looksLikeEmail,
} from "../../components/production-story/lib"

type DesignInfoProps = {
  design?: StoreDesign
  /** The public production story: fabrics, their suppliers, the makers. */
  story?: ProductionStory | null
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

const formatTaskLabel = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <Text className="text-small-semi text-ui-fg-muted uppercase tracking-wide">
    {children}
  </Text>
)

/**
 * "How this piece came together", read top to bottom (#2442): the design's
 * own words, what it is made from and who supplied it, who made it, when, and
 * one way to get the rest. A line with no data is not drawn. Design type,
 * tags and the help popovers are gone: they were our vocabulary (tags like
 * "reference-baethe"), not the shopper's.
 */
export const DesignInfo = ({
  design,
  story,
  activityTimeline,
  hiddenSteps = 0,
  productTitle,
  productHandle,
}: DesignInfoProps) => {
  const [askOpen, setAskOpen] = useState(false)

  if (!design) {
    return null
  }

  const { fabrics, makers } = craftedBy(story, design.partners ?? [])

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

  const palette = (design.color_palette ?? []).filter((c) => c?.code)

  return (
    <div className="flex flex-col gap-y-6" data-testid="design-info">
      <header id={`design-info-${design.id}`} className="flex flex-col gap-y-1">
        <SectionLabel>The making</SectionLabel>
        <Heading level="h3" className="text-xl leading-8 text-ui-fg-base">
          How this piece came together
        </Heading>
      </header>

      {design.description && (
        <Text
          className="text-medium text-ui-fg-subtle whitespace-pre-line leading-7"
          data-testid="design-description"
        >
          {design.description}
        </Text>
      )}

      {(fabrics.length > 0 || makers.length > 0) && (
        <section className="flex flex-col gap-y-2" data-testid="crafted-by">
          <SectionLabel>Crafted by</SectionLabel>
          <ul className="flex flex-col gap-y-2">
            {fabrics.map((f) => (
              <li key={f.id} className="text-small-regular leading-6">
                <span className="text-ui-fg-base">{f.name}</span>
                {f.supplier && (
                  <span className="text-ui-fg-subtle">, from {f.supplier}</span>
                )}
              </li>
            ))}
            {makers.map((m) => (
              <li key={`${m.verb}-${m.id}`} className="text-small-regular leading-6">
                <span className="text-ui-fg-subtle">{m.verb} </span>
                <span className="text-ui-fg-base">{m.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {palette.length > 0 && (
        <section className="flex flex-col gap-y-2">
          <SectionLabel>Colours</SectionLabel>
          <div className="flex flex-wrap items-center gap-3">
            {palette.map((color) => (
              <div
                key={`${color.name}-${color.code}`}
                className="flex items-center gap-x-2"
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-ui-border-base"
                  style={{ backgroundColor: color.code }}
                />
                {color.name && (
                  <Text className="text-small-regular text-ui-fg-subtle">
                    {color.name}
                  </Text>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {timelineSteps.length > 0 && (
        <section className="flex flex-col gap-y-3">
          <SectionLabel>From start to finish</SectionLabel>
          <ol className="flex flex-col">
            {timelineSteps.map((step, i) => {
              const last = i === timelineSteps.length - 1
              const date = formatStoryDate(step.date)
              return (
                <li key={step.id} className="flex flex-col">
                  <div className="flex gap-x-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-ui-bg-base ${
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
                        {hidden} more {hidden === 1 ? "step" : "steps"} in the full story
                      </Text>
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <StoryRequest
        designId={design.id}
        productTitle={productTitle}
        productHandle={productHandle}
        open={askOpen}
        onOpen={() => setAskOpen(true)}
      />
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
  // Only after a Send with a bad address: an untouched box is never red.
  const [badEmail, setBadEmail] = useState(false)

  if (state === "sent") {
    return (
      <Text className="text-small text-ui-fg-subtle" data-testid="story-request-sent">
        Sent. The full making story is on its way to {email.trim()}.
      </Text>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-x-2 self-start text-small-semi text-ui-fg-interactive hover:underline"
        data-testid="story-request-open"
      >
        <LockClosedSolid />
        Get the full making story by email
      </button>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!looksLikeEmail(email)) {
      setBadEmail(true)
      return
    }
    setBadEmail(false)
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
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-y-2"
      data-testid="story-request-form"
    >
      <Text className="text-small text-ui-fg-subtle">
        Every step, the people who made it and what went into it. We send it
        once; no newsletter.
      </Text>
      <div className="flex gap-x-2">
        {/* type="text": a native email field turns red on its own (the UI
            kit styles :invalid) — empty-and-required on load, half-typed
            while typing. We check on Send instead (#2442). */}
        <Input
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (badEmail) setBadEmail(false)
          }}
          aria-label="Your email"
          aria-invalid={badEmail || undefined}
          aria-describedby={badEmail ? "story-email-error" : undefined}
          data-testid="story-request-email"
        />
        <Button type="submit" variant="secondary" isLoading={state === "sending"}>
          Send
        </Button>
      </div>
      {badEmail && (
        <Text id="story-email-error" className="text-small text-ui-fg-error">
          That email doesn’t look right.
        </Text>
      )}
      {state === "error" && (
        <Text className="text-small text-ui-fg-error">
          We couldn’t send it just now. Please try again in a moment.
        </Text>
      )}
    </form>
  )
}
