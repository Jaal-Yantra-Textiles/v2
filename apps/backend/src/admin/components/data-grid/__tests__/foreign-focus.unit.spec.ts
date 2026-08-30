import { isForeignFocusTarget, shouldRestoreAnchorFocus } from "../utils"

/**
 * #1654 — the DataGrid took focus and keystrokes from elements that were not
 * its own.
 *
 * The reported symptom was that typing "12345" into a plain input on a tab
 * that also mounts the grid left the input holding `"1"`, with the caret in a
 * grid cell's input. The cause was NOT the window keydown handlers (both have
 * carried a foreign-input guard since #836) — it was the anchored cell's focus
 * effect, which fired on every grid re-render and pulled focus to itself
 * whenever focus was anywhere else. Typing on the tab causes that re-render,
 * so the second character was always the one lost.
 *
 * These cases pin the ownership rule both handlers now share: an element is
 * the grid's if it is inside a grid cell, and nobody else's element may be
 * taken over.
 */

/** A DOM stand-in with just what the rule reads. */
const makeEl = (
  opts: {
    tagName?: string
    role?: string
    isContentEditable?: boolean
    insideGrid?: boolean
  } = {}
): any => {
  const el: any = {
    tagName: opts.tagName ?? "DIV",
    isContentEditable: opts.isContentEditable ?? false,
    getAttribute: (name: string) => (name === "role" ? opts.role ?? null : null),
    closest: (selector: string) => {
      if (selector.includes("data-cell-id")) {
        return opts.insideGrid ? { id: "cell" } : null
      }
      return null
    },
  }
  return el
}

describe("isForeignFocusTarget (#1654)", () => {
  it("claims a plain text input beside the grid", () => {
    expect(isForeignFocusTarget(makeEl({ tagName: "INPUT" }))).toBe(true)
  })

  it("claims a portaled popover element that has a role but is not an input", () => {
    // The case the old inline check missed: it knew only `role="combobox"`,
    // so a menu item or an option — a div with a role — fell through.
    expect(isForeignFocusTarget(makeEl({ role: "menuitem" }))).toBe(true)
    expect(isForeignFocusTarget(makeEl({ role: "option" }))).toBe(true)
    expect(isForeignFocusTarget(makeEl({ role: "combobox" }))).toBe(true)
  })

  it("claims a contenteditable region", () => {
    expect(isForeignFocusTarget(makeEl({ isContentEditable: true }))).toBe(true)
  })

  it("does NOT claim the grid's own cell input — the grid must keep working", () => {
    expect(
      isForeignFocusTarget(makeEl({ tagName: "INPUT", insideGrid: true }))
    ).toBe(false)
  })

  it("does not claim a plain non-interactive element, or nothing at all", () => {
    expect(isForeignFocusTarget(makeEl())).toBe(false)
    expect(isForeignFocusTarget(null)).toBe(false)
    expect(isForeignFocusTarget({} as any)).toBe(false)
  })
})

describe("shouldRestoreAnchorFocus (#1654)", () => {
  const container = (contains: boolean): any => ({
    contains: () => contains,
  })

  it("does NOT steal focus from an input beside the grid — the reported bug", () => {
    const typingHere = makeEl({ tagName: "INPUT" })
    expect(shouldRestoreAnchorFocus(container(false), typingHere)).toBe(false)
  })

  it("does not steal focus from a portaled popover the user has open", () => {
    expect(shouldRestoreAnchorFocus(container(false), makeEl({ role: "menuitem" }))).toBe(
      false
    )
  })

  it("still restores focus when nothing else holds it", () => {
    // Arrow-key navigation between cells depends on this: the anchor moves,
    // focus is on <body>, and the new anchor has to take it.
    expect(shouldRestoreAnchorFocus(container(false), null)).toBe(true)
    expect(shouldRestoreAnchorFocus(container(false), makeEl())).toBe(true)
  })

  it("still restores focus when the caret is in another grid cell", () => {
    const otherCell = makeEl({ tagName: "INPUT", insideGrid: true })
    expect(shouldRestoreAnchorFocus(container(false), otherCell)).toBe(true)
  })

  it("does nothing when focus is already inside this cell", () => {
    expect(shouldRestoreAnchorFocus(container(true), makeEl())).toBe(false)
  })

  it("does nothing without a container", () => {
    expect(shouldRestoreAnchorFocus(null, makeEl())).toBe(false)
  })
})
