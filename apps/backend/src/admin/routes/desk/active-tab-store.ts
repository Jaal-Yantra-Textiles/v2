import { useSyncExternalStore } from "react"

/**
 * Tiny module-level store keeping track of every mounted desk tab and
 * which one is currently focused. The breadcrumb (which renders outside
 * the workspace component tree via handle.breadcrumb) reads from here
 * so it can show "where we are" + a back affordance without us having
 * to lift the whole pane state up to a global context.
 *
 * Each EntityPanel publishes its location + navigate ref via setTabState
 * on every internal route change. FlexLayout's onModelChange tells us
 * which tab id is focused.
 */

type NavigateFn = (delta: number) => void

export type TabState = {
  tabId: string
  entityKey: string
  entityLabel: string
  /** Path within the tab's MemoryRouter, e.g. "/designs/abc-123/edit". */
  pathname: string
  /** Navigate inside the tab's MemoryRouter (e.g. (-1) goes back). */
  navigate: NavigateFn
}

const tabRegistry = new Map<string, TabState>()
/**
 * Per-tab display title derived from the panel's primary heading (the
 * record name on a detail page). The desk page renames the FlexLayout tab
 * to this when it's more specific than the generic entity label.
 */
const tabTitles = new Map<string, string>()
let focusedTabId: string | null = null

type Listener = () => void
const listeners = new Set<Listener>()
const notify = () => listeners.forEach((l) => l())

/**
 * Cross-tab open: any component rendered inside an EntityPanel (i.e. inside
 * the inner MemoryRouter) can call `openTabAt(entityKey, path)` to spawn
 * a new tab in the workspace and jump it straight to a specific route.
 * Used for "open this design's partner in a new tab" style links.
 *
 * The handler is registered by the desk page on mount; if no handler is
 * registered (e.g. the helper somehow gets called outside the desk), the
 * call is a no-op rather than a crash.
 */
export type OpenTabFn = (entityKey: string, path?: string) => void
let openTabHandler: OpenTabFn | null = null

export const registerOpenTabHandler = (fn: OpenTabFn): (() => void) => {
  openTabHandler = fn
  return () => {
    if (openTabHandler === fn) openTabHandler = null
  }
}

export const openTabAt: OpenTabFn = (entityKey, path) => {
  openTabHandler?.(entityKey, path)
}

export const setTabState = (s: TabState): void => {
  tabRegistry.set(s.tabId, s)
  notify()
}

export const clearTabState = (tabId: string): void => {
  tabRegistry.delete(tabId)
  tabTitles.delete(tabId)
  if (focusedTabId === tabId) focusedTabId = null
  notify()
}

/**
 * Publish (or clear) a tab's content-derived title. Pass null/empty to
 * clear. No-ops when unchanged so the desk's rename effect doesn't churn.
 */
export const setTabTitle = (tabId: string, title: string | null): void => {
  const current = tabTitles.get(tabId)
  if (title) {
    if (current === title) return
    tabTitles.set(tabId, title)
  } else {
    if (!tabTitles.has(tabId)) return
    tabTitles.delete(tabId)
  }
  notify()
}

/** Snapshot of every tab's derived title keyed by tabId. */
export const getTabTitles = (): Record<string, string> => {
  const out: Record<string, string> = {}
  tabTitles.forEach((title, id) => {
    out[id] = title
  })
  return out
}

export const setFocusedTab = (tabId: string | null): void => {
  if (focusedTabId === tabId) return
  focusedTabId = tabId
  notify()
}

const subscribe = (l: Listener): (() => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export const subscribeTabStore = subscribe

/**
 * Snapshot every tab's current pathname keyed by tabId. The desk page
 * persists this alongside the FlexLayout JSON so tabs come back on the
 * exact route they were on, not just at the entity's list page.
 */
export const getTabPathnames = (): Record<string, string> => {
  const out: Record<string, string> = {}
  tabRegistry.forEach((state, id) => {
    out[id] = state.pathname
  })
  return out
}

const getActiveTab = (): TabState | null =>
  focusedTabId ? tabRegistry.get(focusedTabId) ?? null : null

const getTabCount = (): number => tabRegistry.size

export const useActiveTab = (): TabState | null =>
  useSyncExternalStore(subscribe, getActiveTab, () => null)

export const useTabCount = (): number =>
  useSyncExternalStore(subscribe, getTabCount, () => 0)
