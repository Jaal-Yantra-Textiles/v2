/**
 * Seed default questions onto every tour-type form (or one specific form).
 *
 * The tour visit wizard already shows these questions inline; this seed
 * also stores them as proper FormFields so admins see them in the form
 * builder and individual responses keep a tidy schema.
 *
 * Run for every tour form:
 *   npx medusa exec ./src/scripts/seed-tour-form-fields.ts
 *
 * Run for one form:
 *   FORM_ID=form_01ABC… npx medusa exec ./src/scripts/seed-tour-form-fields.ts
 *
 * Idempotent: re-running keeps the same field set (set-form-fields replaces
 * the field list).
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../modules/forms"
import FormsService from "../modules/forms/service"

const TOUR_DEFAULT_FIELDS = [
  {
    name: "insurance",
    label: "Travel insurance",
    type: "radio" as const,
    required: false,
    help_text: "Some workshops involve sharp tools and dye baths.",
    options: {
      choices: [
        { value: "yes", label: "Yes — covered" },
        { value: "no", label: "No insurance" },
        { value: "unsure", label: "I am not sure" },
      ],
    },
  },
  {
    name: "insurance_provider",
    label: "Insurance provider",
    type: "text" as const,
    required: false,
    placeholder: "Optional",
  },
  {
    name: "arrival_mode",
    label: "How are you arriving?",
    type: "radio" as const,
    required: false,
    options: {
      choices: [
        { value: "train", label: "Train" },
        { value: "plane", label: "Plane" },
        { value: "car", label: "Car / private transfer" },
        { value: "bus", label: "Bus / coach" },
        { value: "already_in_city", label: "Already in town" },
      ],
    },
  },
  {
    name: "arrival_time",
    label: "Approximate arrival time",
    type: "text" as const,
    required: false,
    placeholder: "14:30 on the 4th",
  },
  {
    name: "accommodation",
    label: "Where you are staying",
    type: "text" as const,
    required: false,
    placeholder: "Hotel name / neighbourhood",
  },
  {
    name: "emergency_contact_name",
    label: "Emergency contact name",
    type: "text" as const,
    required: false,
  },
  {
    name: "emergency_contact_phone",
    label: "Emergency contact phone",
    type: "phone" as const,
    required: false,
    placeholder: "+1 555 123 4567",
  },
  {
    name: "notes_for_guide",
    label: "Anything we should know about access, dietary needs, or pace?",
    type: "textarea" as const,
    required: false,
    placeholder: "Mobility, allergies, birthdays, anything at all…",
  },
]

export default async function seedTourFormFields({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const forms: FormsService = container.resolve(FORMS_MODULE)

  const targetId = process.env.FORM_ID

  let tourForms: any[]
  if (targetId) {
    const form = await (forms as any).retrieveForm(targetId).catch(() => null)
    if (!form) {
      logger.error(`Form ${targetId} not found`)
      return
    }
    if (form.type !== "tour") {
      logger.warn(`Form ${targetId} has type=${form.type} (not 'tour') — proceeding anyway`)
    }
    tourForms = [form]
  } else {
    const [list] = await (forms as any).listAndCountForms(
      { type: "tour" },
      { take: 1000, order: { created_at: "ASC" } }
    )
    tourForms = list || []
  }

  if (!tourForms.length) {
    logger.info("No tour forms found.")
    return
  }

  logger.info(`Seeding default questions onto ${tourForms.length} tour form(s)…`)

  for (const form of tourForms) {
    // Pull existing fields, drop ones we own (matched by name) and keep
    // any custom fields the admin added so we don't trample their work.
    const [existing] = await (forms as any).listAndCountFormFields(
      { form_id: form.id },
      { take: 1000 }
    )
    const ownedNames = new Set(TOUR_DEFAULT_FIELDS.map((f) => f.name))
    const kept = (existing || [])
      .filter((f: any) => !ownedNames.has(f.name))
      .map((f: any) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        required: !!f.required,
        placeholder: f.placeholder ?? null,
        help_text: f.help_text ?? null,
        options: f.options ?? null,
        validation: f.validation ?? null,
        order: typeof f.order === "number" ? f.order : 0,
        metadata: f.metadata ?? null,
      }))

    const baseOrder = kept.length
      ? Math.max(...kept.map((f: any) => f.order || 0)) + 1
      : 0

    const seeded = TOUR_DEFAULT_FIELDS.map((f, idx) => ({
      ...f,
      order: baseOrder + idx,
    }))

    // Replace the form's fields wholesale (keeps any non-default fields
    // the admin had configured + applies our defaults at the end).
    if (existing?.length) {
      await (forms as any).deleteFormFields(existing.map((f: any) => f.id))
    }
    await (forms as any).createFormFields(
      [...kept, ...seeded].map((f: any) => ({ ...f, form_id: form.id }))
    )

    logger.info(`  ${form.id} (${form.handle}) — seeded ${seeded.length} default question(s), kept ${kept.length} custom`)
  }

  logger.info("Done.")
}
