/**
 * #1920 — the Photo Shoot task category and its templates.
 *
 * ## Why these exist
 *
 * A produced garment is not sellable until it has been PHOTOGRAPHED. That is
 * why `applyRunApprovals` only moves a design to `Commerce_Ready` once its
 * linked media folder holds an image — the shoot is the gate between "we made
 * it" and "we can sell it".
 *
 * Until now the shoot was the one step in that chain nobody could see. There
 * are 23 task templates in production and not one of them covers it, so the
 * work that decides whether a design ever reaches the catalogue was happening
 * off the system entirely — unassignable, unscheduled and uncosted.
 *
 * ## Why they carry a cost and a duration
 *
 * Production-run dispatch resolves templates BY NAME and copies
 * `estimated_cost` / `estimated_duration` onto the task it creates. Costing the
 * shoot is the point: a photoshoot is real money and real hours spent on a
 * design AFTER production, and nothing in the design's cost estimate accounts
 * for it today. `estimate-design-cost` totals
 * `material_cost + production_cost + platform_fee` and stops there.
 *
 * 🔴 These figures are STARTING points, per shoot unless the name says
 * otherwise, and deliberately conservative. They are what an operator edits in
 * Settings → Task Templates once real shoots have been run — which is exactly
 * why the installer never overwrites an existing template.
 *
 * ## What they are NOT
 *
 * Attaching these does not itself make anything `Commerce_Ready`. The status
 * asks for the photographs, not for a ticked box: a task marked done with no
 * images behind it is a claim, and the folder is the artefact. The tasks are
 * how the work gets assigned, scheduled and paid for; the images are how it
 * gets believed.
 *
 * Exported as plain definitions so the CLI seed and the Data Plumbing console
 * job share one source of truth — the pattern
 * `seed-goods-transfer-task-template` established.
 */

export const PHOTOSHOOT_CATEGORY_NAME = "Photo Shoot"

export const PHOTOSHOOT_CATEGORY_DEF = {
  name: PHOTOSHOOT_CATEGORY_NAME,
  description:
    "Everything between finished goods and a sellable listing: styling, the shoot itself, retouching, and getting the images onto the design.",
}

export type PhotoshootTemplateDef = {
  name: string
  description: string
  priority: "low" | "medium" | "high"
  estimated_duration: number
  estimated_cost: number | null
  cost_currency: string | null
  eventable: boolean
  notifiable: boolean
  required_fields: Array<Record<string, any>>
  metadata: Record<string, any>
}

/**
 * Ordered as the work actually happens. Each is separately assignable because
 * they are routinely done by different people — a stylist, a photographer and
 * a retoucher are three bookings, not one.
 */
export const PHOTOSHOOT_TEMPLATE_DEFS: PhotoshootTemplateDef[] = [
  {
    name: "photoshoot-styling",
    description:
      "Prepare the produced garment for the camera: press and steam, style with props or a model, and set the look. Blocks the shoot itself.",
    priority: "medium",
    estimated_duration: 90,
    estimated_cost: 1500,
    cost_currency: "INR",
    eventable: true,
    notifiable: true,
    required_fields: [
      {
        name: "styling_notes",
        type: "text",
        required: false,
        label: "Styling notes",
        help: "How the piece should be shown — on a model, flat lay, on a form.",
      },
    ],
    metadata: { entity: "production_run", issue: "1920", stage: "styling" },
  },
  {
    name: "photoshoot-capture",
    description:
      "Shoot the garment. Covers the photographer's time, studio or location, and lighting. The output is raw frames, not the final images.",
    priority: "high",
    estimated_duration: 180,
    estimated_cost: 6000,
    cost_currency: "INR",
    eventable: true,
    notifiable: true,
    required_fields: [
      {
        name: "shoot_type",
        type: "enum",
        required: true,
        label: "Shoot type",
        options: ["studio", "location", "flat_lay", "on_model", "detail"],
      },
      {
        name: "frames_captured",
        type: "number",
        required: false,
        label: "Frames captured",
      },
    ],
    metadata: { entity: "production_run", issue: "1920", stage: "capture" },
  },
  {
    name: "photoshoot-retouch",
    description:
      "Select, colour-correct and retouch the frames worth keeping. Colour accuracy matters here — a customer returns a garment that arrives a different shade from the photograph.",
    priority: "medium",
    estimated_duration: 120,
    estimated_cost: 2500,
    cost_currency: "INR",
    eventable: true,
    notifiable: true,
    required_fields: [
      {
        name: "images_delivered",
        type: "number",
        required: false,
        label: "Images delivered",
      },
    ],
    metadata: { entity: "production_run", issue: "1920", stage: "retouch" },
  },
  {
    name: "photoshoot-upload",
    description:
      "Put the finished images in the design's linked media folder. 🔑 This is the step that actually makes the design Commerce_Ready — approval reads the FOLDER, not this task, so a design whose images never land here stays at Approved no matter how many tasks are ticked.",
    priority: "high",
    estimated_duration: 30,
    // Our own time, not a billable outside cost.
    estimated_cost: null,
    cost_currency: null,
    eventable: true,
    notifiable: true,
    required_fields: [
      {
        name: "media_folder_id",
        type: "text",
        required: true,
        label: "Design media folder",
        help: "The folder linked to the design. Images landing anywhere else do not count.",
      },
    ],
    metadata: { entity: "production_run", issue: "1920", stage: "upload" },
  },
]

/** Every template name this seed owns — the installer's idempotency key. */
export const PHOTOSHOOT_TEMPLATE_NAMES = PHOTOSHOOT_TEMPLATE_DEFS.map(
  (t) => t.name
)

/**
 * What one full shoot is budgeted at, per design. Summed from the definitions
 * rather than written down twice, so editing a template moves the number and
 * nothing drifts. `null` costs (our own time) contribute nothing.
 */
export function photoshootBudget(
  defs: PhotoshootTemplateDef[] = PHOTOSHOOT_TEMPLATE_DEFS
): { cost: number; currency: string | null; minutes: number } {
  const currency =
    defs.find((d) => d.estimated_cost != null && d.cost_currency)
      ?.cost_currency ?? null

  return {
    cost: defs.reduce((s, d) => s + (Number(d.estimated_cost) || 0), 0),
    currency,
    minutes: defs.reduce((s, d) => s + (Number(d.estimated_duration) || 0), 0),
  }
}
