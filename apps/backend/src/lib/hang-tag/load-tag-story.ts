import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { loadDesignStory } from "../../api/store/custom/designs/production-story-lib/load-story"
import { buildTagStory, TagPartnerFacts, TagStory } from "./tag-story"

const fullName = (p: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
  [p?.first_name, p?.last_name]
    .map((s) => (s ?? "").trim())
    .filter((s) => s && s !== "-")
    .join(" ") || null

/** Owner admin first, else the first admin with a name. */
export function pickLead(
  admins: Array<{ first_name?: string | null; last_name?: string | null; role?: string | null }> | null | undefined
): string | null {
  const list = admins ?? []
  const owner = list.find((a) => a?.role === "owner" && fullName(a))
  return fullName(owner ?? list.find((a) => fullName(a)))
}

/**
 * "City, State" from the partner's warehouses. Several warehouses in different
 * places → no place: the tag would be guessing which one made this piece.
 */
export function pickPlace(
  locations: Array<{ address?: { city?: string | null; province?: string | null } | null } | null> | null | undefined
): string | null {
  const places = new Set(
    (locations ?? [])
      .map((l) => [l?.address?.city, l?.address?.province].map((s) => (s ?? "").trim()).filter(Boolean).join(", "))
      .filter(Boolean)
  )
  return places.size === 1 ? Array.from(places)[0] : null
}

/**
 * The hang-tag story for one design: the shared production story, plus each
 * partner's lead person and place, plus each fabric's technique. `null` when
 * the design does not exist.
 */
export async function loadTagStory(
  scope: { resolve: (key: string) => any },
  designId: string
): Promise<TagStory | null> {
  const loaded = await loadDesignStory(scope, designId)
  if (!loaded) return null
  const story = loaded.production_story
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

  const partnerIds = Array.from(
    new Set([
      ...story.partners.map((p) => p.id),
      ...story.materials.map((m) => m.supplier?.id).filter((id): id is string => !!id),
    ])
  )
  const materialIds = story.materials.map((m) => m.id)

  const [{ data: partners }, { data: materials }] = await Promise.all([
    partnerIds.length
      ? query.graph({
          entity: "partner",
          filters: { id: partnerIds },
          fields: [
            "id",
            "admins.first_name",
            "admins.last_name",
            "admins.role",
            "stock_locations.address.city",
            "stock_locations.address.province",
          ],
        })
      : Promise.resolve({ data: [] }),
    materialIds.length
      ? query.graph({
          entity: "raw_materials",
          filters: { id: materialIds },
          fields: ["id", "specifications"],
        })
      : Promise.resolve({ data: [] }),
  ])

  const partnerFacts: Record<string, TagPartnerFacts> = {}
  for (const p of partners ?? []) {
    partnerFacts[p.id] = { lead: pickLead(p.admins), place: pickPlace(p.stock_locations) }
  }
  const techniques: Record<string, string | null> = {}
  for (const m of materials ?? []) {
    const t = m?.specifications?.technique
    techniques[m.id] = typeof t === "string" ? t : null
  }

  return buildTagStory({ story, partnerFacts, techniques })
}
