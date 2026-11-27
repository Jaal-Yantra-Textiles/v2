import LocalizedClientLink from "@modules/common/components/localized-client-link"

import { ButtonMark, NeedleMark } from "./making-marks"
import StitchedSection from "./stitched-section"

type Pillar = {
  title: string
  body: string
}

/**
 * The six promises that separate a Cici Label piece from a mass-produced
 * one. Kept as plain data so the copy can be edited without touching the
 * markup below.
 */
const PILLARS: Pillar[] = [
  {
    title: "Unique pieces",
    body: "One of one, or one of a handful. The loom decides how much cloth there is, so nothing is ever repeated exactly.",
  },
  {
    title: "Buying from the artist",
    body: "You buy from the person who made it — not a middleman, not a warehouse. The maker is named on every listing.",
  },
  {
    title: "Provenance verified",
    body: "Where the fibre came from, who spun it, who wove it, and when. Written down, not implied.",
  },
  {
    title: "Hand spun or mill spun",
    body: "Both are honest. We say which one it is, and why it was chosen, rather than letting the word “handmade” do the work.",
  },
  {
    title: "Handloomed",
    body: "Woven on a pit or frame loom by hand. The slight irregularities in the cloth are the loom's signature, not a defect.",
  },
  {
    title: "Personally verified",
    body: "Every piece is checked in the valley before it ships — seams, dye fastness, hand-feel — by the same people who commissioned it.",
  },
]

const Provenance = () => {
  return (
    <StitchedSection className="w-full border-t border-neutral-900/10 bg-white pb-16">
      <div className="content-container relative z-10 grid grid-cols-1 gap-12 py-24 small:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] small:gap-20 small:py-32">
        <div className="max-w-md">
          <p className="txt-small uppercase tracking-[0.28em] text-ui-fg-muted">
            The making
          </p>
          <h2 className="mt-6 font-serif text-3xl leading-[1.1] tracking-tight text-balance text-neutral-900 small:text-5xl">
            Every piece can be traced back to a pair of hands.
          </h2>
          <p className="mt-6 txt-medium leading-relaxed text-ui-fg-subtle">
            Slow cloth is only slow if you can see the whole of it — the
            grower, the spinner, the dyer, the weaver, and the hours between.
            Here is what we hold ourselves to.
          </p>
          <LocalizedClientLink
            href="/store"
            className="group mt-8 inline-flex items-center gap-2 txt-small uppercase tracking-[0.18em] text-ui-fg-base"
          >
            Shop the pieces
            <span
              aria-hidden
              className="transition-transform duration-150 ease-in-out group-hover:translate-x-1"
            >
              →
            </span>
          </LocalizedClientLink>

          {/* The needle (its thread runs through the pillars) and a button. */}
          <div className="mt-14 flex items-end gap-10 small:mt-20">
            <NeedleMark className="h-48 w-12 shrink-0 small:h-60 small:w-[60px]" />
            <ButtonMark className="h-28 w-auto small:h-36" />
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-10 gap-y-9 small:grid-cols-2">
          {PILLARS.map((pillar, index) => (
            <div
              key={pillar.title}
              data-pillar
              className="border-t border-neutral-900/10 pt-5"
            >
              <span
                aria-hidden
                className="txt-small tabular-nums tracking-[0.18em] text-neutral-900/30"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <dt className="mt-2 font-serif text-lg tracking-tight text-neutral-900 small:text-xl">
                {pillar.title}
              </dt>
              <dd className="mt-2 txt-small leading-relaxed text-ui-fg-subtle">
                {pillar.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </StitchedSection>
  )
}

export default Provenance
