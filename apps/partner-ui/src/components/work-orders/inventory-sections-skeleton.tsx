import { Container } from "@medusajs/ui"

import {
  GeneralSectionSkeleton,
  HeadingSkeleton,
  Skeleton,
} from "../common/skeleton"

/**
 * Loading state for the inventory half of a work-order.
 *
 * The order detail resolves its inventory order one hop after the order itself
 * (order → inventory_order via `legacy_id`), so between the order rendering and
 * the inventory order arriving the summary / lines / payments / fulfillments /
 * shipments stack simply was not in the tree: the page painted the status card
 * and then, a beat later, every section popped in below it and shoved the page
 * down. This stands in for that stack — summary, lines, payments, fulfillments,
 * shipments — so the layout is stable from the first paint and the wait reads
 * as loading rather than as an order with no inventory on it.
 *
 * Mirrors the real stack's shape, not its exact row count — a skeleton that
 * tracked the content byte-for-byte would have to know the inventory order
 * before it could describe it.
 */
export const InventorySectionsSkeleton = () => {
  return (
    <div className="flex flex-col gap-y-3" aria-hidden>
      {/* Summary */}
      <GeneralSectionSkeleton rowCount={4} />

      {/* Lines */}
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <HeadingSkeleton level="h2" characters={8} />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="grid grid-cols-2 items-center gap-x-4 px-6 py-4"
          >
            <div className="flex items-center gap-x-3">
              <Skeleton className="size-10 rounded-[8px]" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-4 w-20 justify-self-end" />
          </div>
        ))}
      </Container>

      {/* Payments */}
      <GeneralSectionSkeleton rowCount={2} />

      {/* Fulfillments */}
      <GeneralSectionSkeleton rowCount={2} />

      {/* Shipments */}
      <GeneralSectionSkeleton rowCount={2} />
    </div>
  )
}