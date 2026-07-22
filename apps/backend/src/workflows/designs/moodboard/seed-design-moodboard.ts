/**
 * seed-design-moodboard.ts — prepare a design's moodboard as an editable
 * snapshot the moment a designer is invited (#1113).
 *
 * The moodboard scene builders (build-moodboard-scene.ts) turn a design's brief
 * + tech-pack data into native, editable Excalidraw frames. Historically that
 * only ran on an explicit "Generate from brief" click, so an invited designer
 * opened a blank board. This helper runs the same build and persists it to
 * `design.moodboard` up-front — so the designer lands on a populated,
 * Figma-style board they can edit immediately (the landing preview and the
 * post-accept canvas both render `design.moodboard` verbatim).
 *
 * Pure orchestration over existing pieces; no new scene logic here.
 */
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateDesignWorkflow } from "../update-design"
import DesignRawMaterialGroupLink from "../../../links/design-raw-material-group"
import {
  buildMoodboardScene,
  briefHasContent,
  mergeFramesIntoScene,
  type BuildSceneOptions,
  type MoodboardScene,
} from "./build-moodboard-scene"
import {
  assessTechPackCompleteness,
  buildTechPackInputFromDesign,
  type DesignForTechPack,
} from "./techpack-input-from-design"

/**
 * Scene options for the designer-workspace template (#1113): index the board +
 * scaffold a workspace on the initial seed. Reused by every seed/generate caller
 * so the structured board is identical wherever it's produced.
 */
export const WORKSPACE_SCENE_OPTS: BuildSceneOptions = {
  includeContents: true,
  includeWorkspace: true,
}
/** Refresh/regenerate variant — keep the index, but never re-emit (clobber) the workspace. */
export const REFRESH_SCENE_OPTS: BuildSceneOptions = {
  includeContents: true,
  includeWorkspace: false,
}

/**
 * Graph fields needed to build the moodboard scene (brief anchor frames +
 * tech-pack sources). Shared so the generate route and the seed path can't
 * drift apart.
 */
export const DESIGN_MOODBOARD_GRAPH_FIELDS = [
  "id",
  "name",
  "design_type",
  "metadata",
  "thumbnail_url",
  "color_palette",
  // Brief columns → the anchor frames.
  "concept_theme",
  "aesthetic_keywords",
  "persona",
  "competitors",
  "price_point",
  "design_budget",
  "cost_currency",
  "milestones",
  "target_completion_date",
  // Existing board (for merge-not-clobber) + tech-pack sources.
  "moodboard",
  "size_sets.size_label",
  "size_sets.measurements",
  "specifications.title",
  "specifications.category",
  "specifications.details",
  "specifications.special_instructions",
  "specifications.metadata",
] as const

const sceneHasElements = (mb: unknown): boolean => {
  const scene = mb as MoodboardScene | null
  return !!(scene && Array.isArray(scene.elements) && scene.elements.length > 0)
}

export interface BuiltDesignMoodboard {
  /** The freshly-built scene (for a replace/regenerate). */
  scene: MoodboardScene
  /** The scene merged onto any existing board (safe to persist for a seed/refresh). */
  merged: MoodboardScene
  /** Whether the design already had a non-empty moodboard before this build. */
  existingHasElements: boolean
}

/**
 * Load a design plus the extra relations the moodboard needs that aren't design
 * columns — currently the pinned raw-material groups (via the design↔group
 * link). Attaches them as `design.materials` so the pure mapper can consume them.
 */
export async function loadDesignForMoodboard(
  scope: any,
  designId: string
): Promise<DesignForTechPack & { moodboard?: MoodboardScene | null }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "designs",
    filters: { id: designId },
    fields: [...DESIGN_MOODBOARD_GRAPH_FIELDS],
  })
  const design = data?.[0]
  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design ${designId} not found`
    )
  }

  // Pinned material groups ride on a link, not a design column — pull them
  // separately (same query the admin material-groups route uses). Defensive: a
  // missing link/relation just yields no Materials frame.
  let materials: DesignForTechPack["materials"] = []
  try {
    const { data: rows } = await query.graph({
      entity: DesignRawMaterialGroupLink.entryPoint,
      fields: [
        "raw_material_group.name",
        "raw_material_group.composition",
        "raw_material_group.status",
        "raw_material_group.raw_materials.name",
      ],
      filters: { design_id: designId },
    })
    materials = (rows ?? [])
      .map((r: any) => {
        const g = r?.raw_material_group
        if (!g?.name) return null
        const colors = Array.isArray(g.raw_materials)
          ? g.raw_materials.map((rm: any) => rm?.name).filter(Boolean)
          : []
        return {
          name: g.name,
          composition: g.composition ?? null,
          status: g.status ?? null,
          colors: colors.length ? colors : null,
        }
      })
      .filter(Boolean) as DesignForTechPack["materials"]
  } catch {
    materials = []
  }

  return { ...(design as any), materials }
}

/**
 * Load a design and build its moodboard scene (brief + tech-pack + workspace
 * frames), merged onto any existing board. Does NOT persist. Returns null when
 * there's nothing to render yet (no brief and an incomplete tech-pack).
 */
export async function buildDesignMoodboard(
  scope: any,
  designId: string,
  opts?: BuildSceneOptions
): Promise<BuiltDesignMoodboard | null> {
  const design = await loadDesignForMoodboard(scope, designId)

  const input = buildTechPackInputFromDesign(design)
  const completeness = assessTechPackCompleteness(input)
  if (!briefHasContent(input.brief) && !completeness.ok) {
    return null
  }

  const existing = (design as any).moodboard as MoodboardScene | null
  const scene = buildMoodboardScene(input, opts)
  const merged = mergeFramesIntoScene(existing, scene)
  return { scene, merged, existingHasElements: sceneHasElements(existing) }
}

/**
 * Seed the design's moodboard from its brief IF the board is currently empty —
 * never clobbers a board that already has content (an admin-authored or
 * designer-edited scene). Returns the seeded scene, or null when nothing was
 * seeded (no brief/tech-pack yet, or the board was already populated).
 *
 * Intended to run best-effort from the invite mint/accept paths.
 */
export async function seedDesignMoodboardIfEmpty(
  scope: any,
  designId: string
): Promise<MoodboardScene | null> {
  // First seed of an empty board → include the workspace scaffold.
  const built = await buildDesignMoodboard(scope, designId, WORKSPACE_SCENE_OPTS)
  if (!built || built.existingHasElements) {
    return null
  }

  await updateDesignWorkflow(scope).run({
    input: { id: designId, moodboard: built.merged } as any,
  })
  return built.merged
}
