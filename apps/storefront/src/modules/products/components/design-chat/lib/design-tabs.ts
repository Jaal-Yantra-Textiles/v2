/**
 * The designs one studio chat holds (#2556).
 *
 * The backend keeps ONE active design (`context.design_id`) and the others in
 * `context.designs[]`, each with its own access token. The storefront keeps
 * the same list as tabs on the board: tools hand designs back (start, switch,
 * link, list), the maker can click between them, and every request sends the
 * non-active ones so the model knows they exist.
 */

export type DesignTab = {
  design_id: string
  design_token?: string
  name?: string | null
  product_type?: string | null
  thumbnail_url?: string | null
}

/** Must match the backend's MAX_DESIGNS_PER_CONVERSATION. */
export const MAX_DESIGN_TABS = 12

/**
 * Upsert by id, keeping first-seen order. A later entry fills in what an
 * earlier one lacked (a token, a name) but never blanks a known value.
 */
export function mergeDesignTabs(tabs: DesignTab[], incoming: DesignTab[]): DesignTab[] {
  const out = tabs.map((t) => ({ ...t }))
  for (const next of incoming) {
    if (!next?.design_id) continue
    const at = out.findIndex((t) => t.design_id === next.design_id)
    if (at === -1) {
      out.push({ ...next })
      continue
    }
    const merged: DesignTab = { ...out[at] }
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== null && v !== "") (merged as any)[k] = v
    }
    out[at] = merged
  }
  return out.slice(-MAX_DESIGN_TABS)
}

/** What the request sends as `context.designs`: every tab but the active one. */
export function otherDesigns(
  tabs: DesignTab[],
  activeId: string | null | undefined
): Array<{ design_id: string; design_token?: string }> {
  return tabs
    .filter((t) => t.design_id !== activeId)
    .slice(0, MAX_DESIGN_TABS - 1)
    .map((t) => ({
      design_id: t.design_id,
      ...(t.design_token ? { design_token: t.design_token } : {}),
    }))
}

/** A short label for a tab. */
export function designTabLabel(tab: DesignTab, index: number): string {
  const name = tab.name?.trim()
  if (name && !/^new design/i.test(name)) return name.length > 24 ? `${name.slice(0, 23)}…` : name
  if (tab.product_type) return tab.product_type[0].toUpperCase() + tab.product_type.slice(1)
  return `Design ${index + 1}`
}
