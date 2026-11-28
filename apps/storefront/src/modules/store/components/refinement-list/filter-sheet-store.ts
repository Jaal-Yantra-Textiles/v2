"use client"

import { useSyncExternalStore } from "react"

/**
 * Tiny shared store for the mobile filter ActionSheet.
 *
 * The sheet lives in `RefinementList` (it owns the sort/collection/tag
 * controls), but on /store the trigger moved into the search pill, which is
 * a sibling rendered in the other column. A module-level flag lets the
 * trigger open the sheet without lifting state through the server-rendered
 * template.
 */
let open = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function openFilterSheet() {
  if (open) return
  open = true
  emit()
}

export function closeFilterSheet() {
  if (!open) return
  open = false
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useFilterSheetOpen() {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false
  )
}
