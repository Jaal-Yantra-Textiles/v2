import { Container, Heading, Text, clx } from "@medusajs/ui"

import type { CraftedBy } from "@modules/products/components/production-story/lib"
import { listingJourney } from "./lib"

type ListingInProgressProps = {
  /** Real fabrics and makers from the production story, when there is one. */
  crafted?: CraftedBy | null
}

/**
 * Shown in place of the gallery while a product has no photos
 * (`hasProductPhotos()` is false). A short journey of how the piece is made,
 * ending on the step happening now: the photoshoot. Disappears by itself once
 * a photo is uploaded.
 */
const ListingInProgress = ({ crafted }: ListingInProgressProps) => {
  const { steps, fromStory } = listingJourney(crafted)

  return (
    <div className="flex items-start relative">
      <Container
        className="flex flex-col flex-1 small:mx-16 gap-y-8 bg-ui-bg-subtle p-8 small:p-12"
        data-testid="listing-in-progress"
      >
        <header className="flex flex-col gap-y-2">
          <Text className="text-small-semi text-ui-fg-muted uppercase tracking-wide">
            Listing in progress
          </Text>
          <Heading level="h2" className="text-2xl leading-9 text-ui-fg-base">
            This piece is having its photoshoot
          </Heading>
          <Text className="text-medium text-ui-fg-subtle leading-7">
            Everything here is made by hand, so photos come last. They will be
            up soon, and you can buy the piece then.
          </Text>
        </header>

        <section className="flex flex-col gap-y-4">
          <Text className="text-small-semi text-ui-fg-muted uppercase tracking-wide">
            {fromStory ? "How this piece was made" : "How we work"}
          </Text>
          <ol className="flex flex-col" data-testid="listing-journey">
            {steps.map((step, index) => {
              const last = index === steps.length - 1
              return (
                <li
                  key={step.id}
                  className="flex gap-x-4"
                  data-testid="listing-journey-step"
                  aria-current={step.current ? "step" : undefined}
                >
                  <div className="flex flex-col items-center">
                    <span
                      className={clx(
                        "relative mt-1.5 flex h-3 w-3 shrink-0 rounded-full",
                        step.current ? "bg-ui-fg-interactive" : "bg-ui-fg-base"
                      )}
                    >
                      {step.current && (
                        <span className="absolute inset-0 rounded-full bg-ui-fg-interactive opacity-60 animate-ping" />
                      )}
                    </span>
                    {!last && (
                      <span className="w-px flex-1 bg-ui-border-strong my-1" />
                    )}
                  </div>
                  <div className={clx("flex flex-col", !last && "pb-6")}>
                    <Text
                      className={clx(
                        "txt-compact-medium-plus",
                        step.current
                          ? "text-ui-fg-interactive"
                          : "text-ui-fg-base"
                      )}
                    >
                      {step.title}
                    </Text>
                    <Text className="text-small-regular text-ui-fg-subtle">
                      {step.detail}
                    </Text>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      </Container>
    </div>
  )
}

export default ListingInProgress
