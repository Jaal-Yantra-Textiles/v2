import { Container } from "@medusajs/ui"

import {
  GeneralSectionSkeleton,
  HeadingSkeleton,
  Skeleton,
} from "../common/skeleton"

/**
 * Loading state for the design half of a work-order.
 *
 * The order detail resolves its design in two hops (order → production run →
 * design), so between the order rendering and the design arriving the design
 * sections simply were not in the tree: the page painted the status card and
 * then, a beat later, four sections popped in below it and shoved everything
 * down. This stands in for that stack — summary, media grid, sizes, BOM — so
 * the layout is stable from the first paint and the wait reads as loading
 * rather than as an order with no design on it.
 *
 * Mirrors the real stack's shape (`DesignSpecs` + `DesignMediaSection`), not
 * its exact row count — a skeleton that tracked the content byte-for-byte
 * would have to know the design before it could describe it.
 */
export const DesignSectionsSkeleton = () => {
  return (
    <div className="flex flex-col gap-y-3" aria-hidden>
      {/* Summary — type / status / priority / target date / cost / materials */}
      <GeneralSectionSkeleton rowCount={5} />

      {/* Media — the thumbnail grid */}
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <HeadingSkeleton level="h2" characters={5} />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4 px-6 py-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-square size-full rounded-[8px]" />
          ))}
        </div>
      </Container>

      {/* Sizes + BOM */}
      <GeneralSectionSkeleton rowCount={3} />
      <GeneralSectionSkeleton rowCount={4} />
    </div>
  )
}
