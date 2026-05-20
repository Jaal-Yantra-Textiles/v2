import type { IJsonModel, Model } from "flexlayout-react"

/**
 * Versioned local-storage persistence for the desk workspace.
 *
 * What this module owns: read/write the on-disk blob, validate its shape,
 * migrate forward when the format changes. Callers don't need to know
 * which keys are used or that there was ever a v2 layout/v2 paths split.
 *
 * Schema versioning:
 *   __v: 1  — current. { layout: IJsonModel, tab_paths: Record<string, string> }
 *
 * The original prototype stored two separate keys (jyt:desk:layout-v2,
 * jyt:desk:tab-paths-v2) without a version field, which meant every
 * schema change had to bump the key and silently drop user state. The
 * `__v` field lets future format changes ship as forward migrations
 * inside parsePersisted() instead.
 */

const STORAGE_KEY = "jyt:desk:workspace-v3"

const LEGACY_LAYOUT_KEY = "jyt:desk:layout-v2"
const LEGACY_PATHS_KEY = "jyt:desk:tab-paths-v2"

export const CURRENT_VERSION = 1 as const

export type PersistedWorkspace = {
  __v: typeof CURRENT_VERSION
  layout: IJsonModel
  tab_paths: Record<string, string>
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const looksLikeFlexLayoutJson = (v: unknown): v is IJsonModel => {
  if (!isPlainObject(v)) return false
  const layout = (v as Record<string, unknown>).layout
  return isPlainObject(layout) && typeof (layout as Record<string, unknown>).type === "string"
}

const sanitizePaths = (v: unknown): Record<string, string> => {
  if (!isPlainObject(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === "string" && typeof val === "string") out[k] = val
  }
  return out
}

/**
 * Try to read the v3 blob. Returns null if missing, malformed, or from
 * an unknown future version — the caller treats null as "start empty".
 */
const readV3 = (): PersistedWorkspace | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isPlainObject(parsed)) return null
    const version = parsed.__v
    if (version !== CURRENT_VERSION) return null // unknown forward version
    if (!looksLikeFlexLayoutJson(parsed.layout)) return null
    return {
      __v: CURRENT_VERSION,
      layout: parsed.layout,
      tab_paths: sanitizePaths(parsed.tab_paths),
    }
  } catch {
    return null
  }
}

/**
 * Best-effort read of the legacy v2 split keys. If anything is found,
 * the caller will combine + rewrite as v3 and delete the legacy keys.
 */
const readLegacyV2 = ():
  | { layout: IJsonModel | null; tab_paths: Record<string, string> }
  | null => {
  if (typeof window === "undefined") return null
  try {
    const rawLayout = window.localStorage.getItem(LEGACY_LAYOUT_KEY)
    const rawPaths = window.localStorage.getItem(LEGACY_PATHS_KEY)
    if (!rawLayout && !rawPaths) return null
    let layout: IJsonModel | null = null
    if (rawLayout) {
      const parsed = JSON.parse(rawLayout) as unknown
      if (looksLikeFlexLayoutJson(parsed)) layout = parsed
    }
    const tab_paths = rawPaths
      ? sanitizePaths(JSON.parse(rawPaths) as unknown)
      : {}
    return { layout, tab_paths }
  } catch {
    return null
  }
}

const deleteLegacyKeys = (): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(LEGACY_LAYOUT_KEY)
    window.localStorage.removeItem(LEGACY_PATHS_KEY)
  } catch {
    // best-effort
  }
}

/**
 * Loaded workspace state. `layout` is null when we have nothing to hydrate
 * from — caller builds an empty FlexLayout model in that case.
 */
export type LoadedWorkspace = {
  layout: IJsonModel | null
  tab_paths: Record<string, string>
}

export const loadPersisted = (): LoadedWorkspace => {
  const v3 = readV3()
  if (v3) {
    return { layout: v3.layout, tab_paths: v3.tab_paths }
  }
  const legacy = readLegacyV2()
  if (legacy && legacy.layout) {
    // Migrate forward: write v3 with the legacy data, then delete v2 keys
    // so we don't keep paying the migration cost on every reload.
    persist(legacy.layout, legacy.tab_paths)
    deleteLegacyKeys()
    return { layout: legacy.layout, tab_paths: legacy.tab_paths }
  }
  return { layout: null, tab_paths: {} }
}

export const persist = (
  layout: IJsonModel,
  tab_paths: Record<string, string>
): void => {
  if (typeof window === "undefined") return
  try {
    const blob: PersistedWorkspace = {
      __v: CURRENT_VERSION,
      layout,
      tab_paths,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
  } catch {
    // best-effort — storage quota exceeded or disabled
  }
}

export const persistFromModel = (
  model: Model,
  tab_paths: Record<string, string>
): void => {
  persist(model.toJson(), tab_paths)
}

/** Drop all desk state from localStorage. Used by the Reset action. */
export const clearPersisted = (): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    deleteLegacyKeys()
  } catch {
    // best-effort
  }
}
