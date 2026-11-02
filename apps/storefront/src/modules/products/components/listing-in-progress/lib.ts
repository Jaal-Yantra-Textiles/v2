import type { CraftedBy } from "@modules/products/components/production-story/lib"

export type ListingStep = {
  id: string
  title: string
  detail: string
  /** The step happening now. Only the photoshoot is ever current. */
  current: boolean
}

/** Last step on every journey: the reason the page has no photos yet. */
const PHOTOSHOOT: ListingStep = {
  id: "photoshoot",
  title: "Photoshoot",
  detail: "Being photographed",
  current: true,
}

/**
 * The generic journey of a handmade piece, for a product with no production
 * story. Worded as how we usually work, not as a claim about this piece.
 */
const GENERIC_STEPS: ListingStep[] = [
  { id: "design", title: "Design", detail: "Drawn and sampled", current: false },
  { id: "weave", title: "Weave", detail: "Fabric made on the loom", current: false },
  { id: "dye", title: "Dye", detail: "Coloured by hand", current: false },
  { id: "stitch", title: "Stitch", detail: "Cut and sewn", current: false },
  PHOTOSHOOT,
]

/**
 * The steps the "listing in progress" panel shows.
 *
 * With a production story, the real fabrics and makers from `craftedBy()`
 * become the middle of the journey ("Stitched by Sharlho"), in the same order
 * the "Crafted by" section lists them. Nothing is invented: a stage with no
 * maker on record is simply not shown. With no story, the generic journey.
 */
export function listingJourney(crafted: CraftedBy | null | undefined): {
  steps: ListingStep[]
  fromStory: boolean
} {
  const fabrics = crafted?.fabrics ?? []
  const makers = crafted?.makers ?? []

  if (fabrics.length === 0 && makers.length === 0) {
    return { steps: GENERIC_STEPS, fromStory: false }
  }

  const steps: ListingStep[] = [
    { id: "design", title: "Design", detail: "Drawn and sampled", current: false },
    ...fabrics.map((f) => ({
      id: `fabric-${f.id}`,
      title: f.name,
      detail: f.supplier ? `Fabric from ${f.supplier}` : "The fabric",
      current: false,
    })),
    ...makers.map((m) => ({
      id: `maker-${m.verb}-${m.id}`,
      title: m.name,
      detail: m.verb,
      current: false,
    })),
    PHOTOSHOOT,
  ]

  return { steps, fromStory: true }
}
