import { DataGridCoordinates } from "./types"

export function generateCellId(coords: DataGridCoordinates) {
  return `${coords.row}:${coords.col}`
}

/**
 * Check if a cell is equal to a set of coords
 * @param cell - The cell to compare
 * @param coords - The coords to compare
 * @returns Whether the cell is equal to the coords
 */
export function isCellMatch(
  cell: DataGridCoordinates,
  coords?: DataGridCoordinates | null
) {
  if (!coords) {
    return false
  }

  return cell.row === coords.row && cell.col === coords.col
}

const SPECIAL_FOCUS_KEYS = [".", ","]

export function isSpecialFocusKey(event: KeyboardEvent) {
  return SPECIAL_FOCUS_KEYS.includes(event.key) && event.ctrlKey && event.altKey
}
/**
 * #1654 — an element the user is actively working in that is NOT part of a
 * data grid.
 *
 * Grid cells mark themselves in the DOM (`data-cell-id` / `data-container-id`
 * / `data-field`), so "inside a grid" is answerable from any element. Anything
 * editable or interactive outside that — a search box beside the grid, a
 * portaled combobox popover, a menu item, a batches field in a popover — is
 * the user's, and the grid must not take focus or keystrokes from it.
 *
 * Roles are checked as well as tags because a portaled popover's focused
 * element is often a `div` with a role, not an `<input>`.
 */
const FOREIGN_INTERACTIVE_ROLES = new Set([
  "combobox",
  "textbox",
  "searchbox",
  "listbox",
  "option",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "spinbutton",
  "slider",
  "switch",
])

const isInsideDataGrid = (el: Element | null): boolean => {
  return !!el?.closest?.("[data-cell-id], [data-container-id], [data-field]")
}

export function isForeignFocusTarget(target: unknown): boolean {
  const el = target as (HTMLElement & { isContentEditable?: boolean }) | null

  if (!el || typeof (el as any).closest !== "function") {
    return false
  }

  if (isInsideDataGrid(el)) {
    return false
  }

  const tag = el.tagName
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  ) {
    return true
  }

  const role = el.getAttribute?.("role")
  return !!role && FOREIGN_INTERACTIVE_ROLES.has(role)
}

/**
 * Whether an anchored cell may pull focus to itself.
 *
 * The anchor is recomputed on every grid re-render, and a re-render happens
 * whenever anything on the tab changes form state — including typing in an
 * input that has nothing to do with the grid. An unconditional self-focus here
 * is what ate the second keystroke of every word typed beside the grid
 * (#1654): the first character lands, the grid re-renders, the anchored cell
 * takes focus, and the rest of the word is typed into a cell.
 */
export function shouldRestoreAnchorFocus(
  container: HTMLElement | null | undefined,
  activeElement: Element | null
): boolean {
  if (!container) {
    return false
  }

  // Focus is already in this cell — nothing to restore.
  if (activeElement && container.contains(activeElement)) {
    return false
  }

  // Focus is somewhere the user put it, and it isn't ours to take.
  if (isForeignFocusTarget(activeElement)) {
    return false
  }

  return true
}
