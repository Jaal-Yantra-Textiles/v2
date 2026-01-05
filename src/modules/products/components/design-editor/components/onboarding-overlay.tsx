"use client"

import { Button, Text } from "@medusajs/ui"
import { XMark } from "@medusajs/icons"
import clsx from "clsx"

type OnboardingStep = {
  title: string
  description: string
}

type OnboardingOverlayProps = {
  visible: boolean
  steps: OnboardingStep[]
  currentStep: number
  onNext: () => void
  onPrev: () => void
  onSkip: () => void
  isMobile?: boolean
}

const OnboardingOverlay = ({
  visible,
  steps,
  currentStep,
  onNext,
  onPrev,
  onSkip,
  isMobile = false,
}: OnboardingOverlayProps) => {
  if (!visible || !steps[currentStep]) {
    return null
  }

  const step = steps[currentStep]

  return (
    <div
      className={clsx(
        "pointer-events-none absolute z-30 transition-all",
        isMobile ? "top-4 left-1/2 -translate-x-1/2 w-[90%]" : "top-24 left-8"
      )}
    >
      <div className="pointer-events-auto max-w-sm rounded-2xl border border-ui-border-base bg-white/95 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3 border-b border-ui-border-base px-4 py-3">
          <div>
            <Text weight="plus" className="text-xs uppercase tracking-wide text-ui-fg-muted">
              Guided setup
            </Text>
            <Text weight="plus" className="text-lg text-ui-fg-base">
              {step.title}
            </Text>
          </div>
          <button
            onClick={onSkip}
            className="rounded-full border border-ui-border-base p-1 text-ui-fg-muted hover:text-ui-fg-base"
            aria-label="Close onboarding"
          >
            <XMark className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3 text-sm text-ui-fg-subtle">
          <Text>{step.description}</Text>
        </div>
        <div className="flex items-center justify-between border-t border-ui-border-base px-4 py-3 text-xs">
          <div className="flex items-center gap-1">
            {steps.map((_, idx) => (
              <span
                key={`dot-${idx}`}
                className={clsx(
                  "h-1.5 w-6 rounded-full",
                  idx <= currentStep ? "bg-ui-fg-base" : "bg-ui-border-base"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={currentStep === 0}
              onClick={onPrev}
              className="disabled:opacity-40"
            >
              Back
            </Button>
            <Button size="small" onClick={onNext}>
              {currentStep === steps.length - 1 ? "Start" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OnboardingOverlay
