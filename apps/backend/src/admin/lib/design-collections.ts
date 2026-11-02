/**
 * Design collections, carried as tags.
 *
 * There is no design-collection model yet, so a collection is a tag with the
 * `collection:` prefix, e.g. `collection:Shramdaan Global Designs`. The prefix
 * keeps collections apart from the feature tags a design also carries
 * ("French knot", "Wooden buttons"), so grouping never turns every feature
 * into a group.
 *
 * Grouping happens here, on the client, on purpose: the list route's `tags`
 * filter compares the WHOLE json array, so `tags[]=collection:X` matches only
 * a design whose tags are exactly `["collection:X"]` — i.e. almost nothing.
 */

export const COLLECTION_TAG_PREFIX = "collection:"
export const NO_COLLECTION_ID = "__no_collection__"
export const NO_COLLECTION_NAME = "No collection"

export const collectionNameFromTag = (tag: unknown): string | null => {
  if (typeof tag !== "string") return null
  if (!tag.toLowerCase().startsWith(COLLECTION_TAG_PREFIX)) return null
  const name = tag.slice(COLLECTION_TAG_PREFIX.length).trim()
  return name || null
}

export const collectionTag = (name: string) => `${COLLECTION_TAG_PREFIX}${name.trim()}`

export type DesignLike = { id: string; tags?: unknown }

export type DesignCollectionGroup<T extends DesignLike> = {
  id: string
  name: string
  designs: T[]
}

/**
 * One group per collection, named groups A–Z, then "No collection" last.
 * A design in two collections appears under both. Collection names are
 * matched case-insensitively and shown as first written.
 */
export const groupDesignsByCollection = <T extends DesignLike>(
  designs: T[]
): DesignCollectionGroup<T>[] => {
  const groups = new Map<string, DesignCollectionGroup<T>>()
  const ungrouped: T[] = []

  for (const design of designs) {
    const tags = Array.isArray(design.tags) ? design.tags : []
    const names = new Map<string, string>()
    for (const tag of tags) {
      const name = collectionNameFromTag(tag)
      if (name) names.set(name.toLowerCase(), names.get(name.toLowerCase()) ?? name)
    }

    if (!names.size) {
      ungrouped.push(design)
      continue
    }

    for (const [key, name] of names) {
      const group = groups.get(key) ?? { id: `collection:${key}`, name, designs: [] }
      group.designs.push(design)
      groups.set(key, group)
    }
  }

  const named = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
  return ungrouped.length
    ? [...named, { id: NO_COLLECTION_ID, name: NO_COLLECTION_NAME, designs: ungrouped }]
    : named
}
