"use client"

import { Button, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"

/**
 * "What is this page?" — a three-step wizard for the first-timer (#1389).
 *
 * ## Why a wizard rather than a list
 *
 * Almost everyone who opens this link is opening their FIRST one: no account,
 * no order history, no navigation they recognise, and it asks them to commit
 * money. A stacked list of three explanations is read as furniture and scrolled
 * past. One question at a time, with a button, is read.
 *
 * It also fixes the phone. Three paragraphs above the prices push the basket
 * off a 375px screen entirely; one step does not.
 *
 * ## Why dismissal is remembered per token
 *
 * 🔑 Forwarding this link round a procurement team is the use case, not an
 * abuse of it, so the same person opens the same page repeatedly. A guide that
 * reappears every visit is the thing people learn to skip — which is how the
 * deposit sentence stops being read. Keyed by token, so dismissing one quote's
 * guide does not silently hide the next quote's.
 *
 * 🔴 Rendered CLOSED on the server and opened after mount. Reading
 * `localStorage` during render hydrates a different tree than the server sent.
 * A returning buyer sees it flash away at worst; a first-timer always gets it.
 */

const storageKey = (token: string) => `jyt.quote.guide.dismissed.${token}`

type Step = { title: string; body: string }

const BASE_STEPS: Step[] = [
  {
    title: "This is a price, not a bill",
    body: "Nothing has been charged and nothing is owed. The prices below were prepared for your company and are held until the date shown on this page.",
  },
  {
    title: "Change the quantities if you need to",
    body: "The totals update against the same agreed rates. Freight is charged once for the whole basket, not per item — so adding a line rarely costs what you would expect.",
  },
  {
    title: "Accept when you are ready",
    body: "Accepting turns this quote into an order and takes you to checkout. You pay a deposit now and the balance before dispatch — both amounts are shown before you pay anything.",
  },
]

const QuoteHowItWorks = ({
  token,
  depositLine,
}: {
  /** Scopes the dismissal, so one quote's guide is not the next quote's. */
  token: string
  /** The REAL split, when the backend computed it. Never a generic sentence. */
  depositLine?: string | null
}) => {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  const steps: Step[] = BASE_STEPS.map((s, i) =>
    // The last step is the one people misremember, so it states the actual
    // numbers wherever we have them rather than "a deposit".
    i === BASE_STEPS.length - 1 && depositLine ? { ...s, body: depositLine } : s
  )

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(storageKey(token))) setOpen(true)
    } catch {
      // Private browsing or a blocked store — show it. A guide shown twice is
      // a smaller failure than a first-timer shown none.
      setOpen(true)
    }
  }, [token])

  const dismiss = () => {
    setOpen(false)
    setStep(0)
    try {
      window.localStorage.setItem(storageKey(token), "1")
    } catch {
      // Nothing to do; it simply shows again next time.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 text-left txt-small text-ui-fg-interactive underline underline-offset-2"
      >
        How this quote works
      </button>
    )
  }

  const current = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div className="mt-6 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 small:p-5">
      <div className="flex items-start justify-between gap-x-4">
        <Text className="txt-small-plus uppercase tracking-wide text-ui-fg-subtle">
          New here? Step {step + 1} of {steps.length}
        </Text>
        <button
          type="button"
          onClick={dismiss}
          // An escape hatch on every step, not only the last. A buyer who
          // already knows how this works must not have to click through three
          // screens to reach their prices.
          className="txt-small text-ui-fg-subtle hover:text-ui-fg-base"
        >
          Skip
        </button>
      </div>

      {/* A fixed minimum height so advancing a step does not reflow the page
          under the reader's thumb — the shortest and longest steps differ by
          about two lines on a phone. */}
      <div className="mt-3 min-h-[104px] small:min-h-[76px]">
        <Text className="txt-medium-plus text-ui-fg-base">{current.title}</Text>
        <Text className="txt-medium text-ui-fg-subtle mt-1">{current.body}</Text>
      </div>

      <div className="mt-4 flex flex-col gap-3 small:flex-row small:items-center small:justify-between">
        <div className="flex items-center gap-x-1.5" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-5 bg-ui-fg-base" : "w-1.5 bg-ui-border-base"
              }`}
            />
          ))}
        </div>

        {/* Full width and stacked on a phone; inline from `small` up. A 44px
            target is the difference between a wizard that gets used on a
            handset and one that gets abandoned. */}
        <div className="flex gap-2">
          {step > 0 ? (
            <Button
              variant="secondary"
              size="small"
              className="flex-1 small:flex-none"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </Button>
          ) : null}
          <Button
            size="small"
            className="flex-1 small:flex-none"
            onClick={() => (isLast ? dismiss() : setStep((s) => s + 1))}
          >
            {isLast ? "Got it" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default QuoteHowItWorks
