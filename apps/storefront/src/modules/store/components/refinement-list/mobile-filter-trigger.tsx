"use client"

import { openFilterSheet } from "./filter-sheet-store"

/**
 * Icon-only filters trigger for the /store search pill.
 *
 * Pages without a search bar (categories, collections) keep the full-width
 * "Filters" button inside `RefinementList`; /store hides that button with
 * `hideMobileTrigger` and renders this instead, opening the same ActionSheet.
 *
 * Mobile only — desktop already shows the persistent filter sidebar.
 */
const MobileFilterTrigger = () => (
  <button
    type="button"
    onClick={openFilterSheet}
    aria-label="Filters"
    data-testid="store-filters-trigger"
    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 small:hidden"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  </button>
)

export default MobileFilterTrigger
