import { Badge, Heading, Text } from "@medusajs/ui"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "What is a Design Score?",
  description:
    "How we trace every JYT piece from concept to finished garment — the Design Score, the production timeline, the people, the materials, and the environmental cost.",
}

/* ------------------------------------------------------------------ */
/* Small presentational mockups — static illustrations of the real UI */
/* ------------------------------------------------------------------ */

const ScoreMeter = ({ score = 4, max = 4 }: { score?: number; max?: number }) => (
  <div className="flex items-center gap-x-2">
    {Array.from({ length: max }).map((_, i) => (
      <span
        key={i}
        className={`h-2 w-8 rounded-full ${
          i < score ? "bg-ui-fg-interactive" : "bg-ui-border-base"
        }`}
      />
    ))}
    <Text className="text-small-regular text-ui-fg-subtle ml-2">
      {score}/{max}
    </Text>
  </div>
)

const TimelineMock = () => {
  const steps = [
    { label: "Run sent to partner", last: false },
    { label: "Partner accepted the run", last: false },
    { label: "Partner started the run", last: false },
    { label: "Partner marked finished", last: false },
    { label: "Run completed", last: true },
  ]
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-x-3">
          <div className="flex flex-col items-center">
            <span
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-ui-bg-subtle ${
                s.last ? "bg-ui-fg-interactive" : "bg-ui-border-strong"
              }`}
            />
            {!s.last && <span className="w-px grow bg-ui-border-base" />}
          </div>
          <div className={`flex flex-col ${s.last ? "" : "pb-4"}`}>
            <Text className="text-small-regular text-ui-fg-base">{s.label}</Text>
            <Text className="text-small text-ui-fg-muted">Jun 14, 2026</Text>
          </div>
        </li>
      ))}
    </ol>
  )
}

const MaterialMock = () => (
  <div className="flex flex-col gap-y-4">
    {[
      { name: "Organic Cotton", color: "beige", comp: "100% Cotton" },
      { name: "Natural Indigo Dye", color: "indigo", comp: "Natural plant dye" },
    ].map((m) => (
      <div key={m.name} className="flex gap-x-3">
        <div
          className="h-12 w-12 shrink-0 rounded-md border border-ui-border-base"
          style={{ backgroundColor: m.color }}
        />
        <div className="flex flex-col text-small-regular">
          <Text className="text-base-semi text-ui-fg-base">{m.name}</Text>
          <span className="text-ui-fg-subtle">{m.comp}</span>
        </div>
      </div>
    ))}
  </div>
)

const CraftedByMock = () => (
  <div className="flex flex-col gap-y-4 text-small-regular">
    <div className="flex flex-col gap-y-1">
      <span className="font-semibold">People who made it</span>
      <span className="text-ui-fg-subtle">Afzal Alam · Tailor</span>
      <span className="text-ui-fg-subtle">Debika Biswas · Finisher</span>
    </div>
    <div className="flex flex-col gap-y-1">
      <span className="font-semibold">Partners</span>
      <span className="text-ui-fg-subtle">Himalayan Weavers Co-op</span>
    </div>
  </div>
)

const EnvCostMock = () => (
  <div className="flex flex-col gap-y-4 text-small-regular">
    <div className="flex flex-col gap-y-1">
      <span className="font-semibold">Energy &amp; labor used</span>
      <span className="text-ui-fg-subtle">Electricity: 4.2 kWh</span>
      <span className="text-ui-fg-subtle">Water: 38 L</span>
      <span className="text-ui-fg-subtle">Labor: 6 hours</span>
    </div>
    <div className="flex flex-col gap-y-1">
      <span className="font-semibold">Output</span>
      <span className="text-ui-fg-subtle">8 units produced</span>
    </div>
    <div className="flex flex-col gap-y-1">
      <span className="font-semibold">Materials consumed</span>
      <span className="text-ui-fg-subtle">Organic Cotton: 3.5 Meter</span>
      <span className="text-ui-fg-subtle">Natural Indigo Dye: 0.5 Kilogram</span>
    </div>
  </div>
)

/** Pairs a plain-language explanation with a UI mockup; stacks on mobile. */
const ExplainerRow = ({
  eyebrow,
  title,
  children,
  mock,
  flip,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
  mock: React.ReactNode
  flip?: boolean
}) => (
  <div className="grid grid-cols-1 items-center gap-8 large:grid-cols-2">
    <div className={flip ? "large:order-2" : ""}>
      <Text size="small" className="uppercase tracking-wide text-ui-fg-muted">
        {eyebrow}
      </Text>
      <Heading level="h3" className="text-xl leading-8 text-ui-fg-base mb-3">
        {title}
      </Heading>
      <div className="text-base-regular text-ui-fg-subtle leading-7">
        {children}
      </div>
    </div>
    <div className={flip ? "large:order-1" : ""}>
      <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-6 shadow-elevation-card-rest">
        {mock}
      </div>
    </div>
  </div>
)

/* ------------------------------------------------------------------ */

const FLOW_STEPS = [
  {
    title: "Concept",
    body: "Every piece starts as a design with a story, type, and intent.",
  },
  {
    title: "Materials sourced",
    body: "We log the exact raw materials — composition, colour, supplier.",
  },
  {
    title: "Crafted by makers",
    body: "Partners and artisans run the production, step by step.",
  },
  {
    title: "Finished & traced",
    body: "The full journey — energy, output, people — stays with the piece.",
  },
]

const SCORE_CRITERIA = [
  { points: "+1", label: "Basic design information is available." },
  { points: "+1", label: "The production journey is documented." },
  { points: "+1", label: "Every partner and maker is named." },
  { points: "+1", label: "Raw materials — composition & sourcing — are logged." },
]

const WhatIsADesignScorePage = () => {
  return (
    <div className="content-container py-12 large:py-16">
      {/* Hero */}
      <div className="max-w-2xl">
        <Text size="small" className="uppercase tracking-wide text-ui-fg-muted">
          Transparency, by design
        </Text>
        <Heading level="h1" className="text-3xl large:text-4xl leading-tight mt-2">
          What is a Design Score?
        </Heading>
        <Text className="text-base-regular text-ui-fg-subtle leading-7 mt-4">
          The Design Score is a 0–4 rating on every product that shows how
          completely we can trace it — from the first concept to the finished
          garment in your hands. The higher the score, the more of the story we
          can show you: who made it, what it&apos;s made of, and what it took to
          make.
        </Text>
        <div className="mt-6">
          <ScoreMeter score={4} max={4} />
        </div>
      </div>

      {/* The journey flow */}
      <section className="mt-16 large:mt-20">
        <Heading level="h2" className="text-2xl leading-9">
          How a piece comes to life
        </Heading>
        <Text className="text-base-regular text-ui-fg-subtle leading-7 mt-3 max-w-2xl">
          Each product on JYT is the end of a documented journey. Here&apos;s the
          flow every piece moves through — and the score climbs as each stage is
          recorded.
        </Text>
        <div className="mt-8 grid grid-cols-1 gap-4 small:grid-cols-2 large:grid-cols-4">
          {FLOW_STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex flex-col gap-y-2 rounded-xl border border-ui-border-base bg-ui-bg-subtle p-5"
            >
              <div className="flex items-center gap-x-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ui-fg-interactive text-ui-fg-on-color text-small-semi">
                  {i + 1}
                </span>
                <Text className="text-base-semi text-ui-fg-base">
                  {step.title}
                </Text>
              </div>
              <Text className="text-small-regular text-ui-fg-subtle leading-6">
                {step.body}
              </Text>
            </div>
          ))}
        </div>
      </section>

      {/* How the score is calculated */}
      <section className="mt-16 large:mt-20">
        <Heading level="h2" className="text-2xl leading-9">
          How the score is calculated
        </Heading>
        <Text className="text-base-regular text-ui-fg-subtle leading-7 mt-3 max-w-2xl">
          One point for each signal of traceability. A 4/4 means complete
          traceability from concept to finished product.
        </Text>
        <div className="mt-8 grid grid-cols-1 gap-4 small:grid-cols-2">
          {SCORE_CRITERIA.map((c) => (
            <div
              key={c.label}
              className="flex items-start gap-x-3 rounded-xl border border-ui-border-base p-5"
            >
              <Badge color="green">{c.points}</Badge>
              <Text className="text-base-regular text-ui-fg-subtle leading-6">
                {c.label}
              </Text>
            </div>
          ))}
        </div>
      </section>

      {/* What you'll see on each product */}
      <section className="mt-16 large:mt-20">
        <Heading level="h2" className="text-2xl leading-9">
          What you&apos;ll see on each product
        </Heading>
        <Text className="text-base-regular text-ui-fg-subtle leading-7 mt-3 max-w-2xl">
          Open any piece with a design and you&apos;ll find these — the same
          records we keep internally, shown to you. No prices, no cost figures —
          just how it was made.
        </Text>

        <div className="mt-10 flex flex-col gap-14 large:gap-20">
          <ExplainerRow
            eyebrow="The making"
            title="A production timeline"
            mock={<TimelineMock />}
          >
            Every production run leaves a trail of checkpoints — sent to the
            partner, accepted, started, finished, completed. We collapse the
            internal parent/child runs into one clean thread so you see the real
            lifecycle, in order, with dates.
          </ExplainerRow>

          <ExplainerRow
            eyebrow="Materials used"
            title="What it&apos;s actually made of"
            flip
            mock={<MaterialMock />}
          >
            The raw materials behind the piece — name, composition, colour, and a
            swatch image where we have one. Sourced from the same inventory our
            makers pull from, so it&apos;s the real material, not a marketing
            label.
          </ExplainerRow>

          <ExplainerRow
            eyebrow="Crafted by"
            title="The people and partners"
            mock={<CraftedByMock />}
          >
            The artisans who made it — by name and role — and the workshops and
            partners we collaborated with. Craft is people; we name them.
          </ExplainerRow>

          <ExplainerRow
            eyebrow="Environmental cost"
            title="What it took to make"
            flip
            mock={<EnvCostMock />}
          >
            The footprint of production — energy and water used, labour hours,
            units produced, and the raw materials consumed. A money-free view of
            the real-world cost of bringing the piece to life.
          </ExplainerRow>
        </div>
      </section>

      {/* Closing */}
      <section className="mt-16 large:mt-20 rounded-2xl border border-ui-border-base bg-ui-bg-subtle p-8 large:p-10">
        <Heading level="h2" className="text-2xl leading-9">
          Why we do this
        </Heading>
        <Text className="text-base-regular text-ui-fg-subtle leading-7 mt-3 max-w-2xl">
          Most of fashion hides its supply chain. We&apos;d rather show ours. The
          Design Score is our promise to keep opening the box — so the more
          complete a piece&apos;s story, the more of it you get to see.
        </Text>
      </section>
    </div>
  )
}

export default WhatIsADesignScorePage
