/**
 * Seed the Florence Silk Weaving Workshop tour form with story,
 * guides, itinerary segments and pricing — the full "tour" settings
 * payload, so the visit wizard renders something rich without an
 * operator having to hand-edit JSON.
 *
 * Re-runnable: replaces only `settings`, leaves form fields and
 * responses alone. The form itself must already exist (created via
 * the admin UI or POST /admin/forms with type=tour).
 *
 * Run:
 *   FORM_ID=form_01KQH52ECNWE1AFV0814VKTMCW \
 *     npx medusa exec ./src/scripts/seed-florence-tour.ts
 *
 * If FORM_ID is omitted the script falls back to the form whose
 * handle is `florence-silk` on the jaalyantra.com domain.
 *
 * Guide entries marked `availability: "na"` are *placeholders* — they
 * surface a "Profile coming soon" treatment on the wizard so customers
 * know the real host hasn't been finalised yet. Flip to "available"
 * once the actual guide is confirmed.
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../modules/forms"
import FormsService from "../modules/forms/service"

const FLORENCE_SETTINGS = {
  story: {
    headline: "A craft journey through Florence, told at your pace.",
    body:
      "Your day is built around two heritage textile institutions — Fondazione Lisio and Tessitura LAB Casini Guidotti — both included in your GetYourGuide booking. From there, you can shape the rest: visit the historic silk factory, meet a contemporary weaver, choose how you'd like to move between sites, and round it off with an artisan lunch. Pick what calls to you. We'll arrange around it.",
  },
  guides: [
    {
      id: "giulio",
      name: "Giulio Bruschi",
      role: "Master weaver, 4th generation",
      bio:
        "Forty years at the loom. Speaks with his hands. Knows every defect in every meter of silk that leaves the floor.",
      photo_url:
        "https://images.unsplash.com/photo-1542740348-39501cd6e2b4?auto=format&fit=crop&w=600&q=80",
      languages: ["English", "Italian"],
      instagram: "giulio.weaves",
      // PLACEHOLDER: this profile is illustrative until we onboard the real
      // host. Customers see "Profile coming soon" treatment.
      availability: "na" as const,
    },
    {
      id: "anjali",
      name: "Anjali Roy",
      role: "Studio host & translator",
      bio:
        "Anjali grew up between Kolkata and Florence. She bridges the workshops with English, Bengali and Italian, and walks you between the sites.",
      photo_url:
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80",
      languages: ["English", "Bengali", "Italian"],
      availability: "na" as const,
    },
  ],
  pricing: {
    currency: "EUR",
    per_category_multiplier: { Adult: 1, Child: 0.5, Senior: 1 },
  },
  practical_guidance: {
    meeting_point:
      "Fondazione Lisio — Via Benedetto Fortini 143, 50125 Firenze. Look for the wooden sign by the gate; we'll meet you in the courtyard 5 minutes before your start time.",
    what_to_wear:
      "Closed-toe shoes (workshop floors are sometimes wet from the dye baths), layers you don't mind getting a little dye-spotted, and comfortable walking shoes if you've added the off-site visits.",
    what_we_provide:
      "Aprons, hand-cleansing wipes, drinking water, and a printed itinerary card. If you've added the artisan lunch, food + house wine are included — no extra charge on the day.",
    what_to_bring:
      "Camera if you'd like (please respect each weaver's preference). A reusable water bottle. A small notebook is lovely if you take notes — Lisio's pattern books are inspiring.",
  },
  itinerary_segments: [
    {
      id: "seg_lisio",
      title: "Fondazione Lisio",
      description:
        "The cornerstone visit, included in your GYG booking. Founded in 1906 by Giuseppe Lisio, the foundation safeguards Florence's hand-loom weaving tradition. You'll see Jacquard looms in motion, browse archival pattern books, and meet the apprentice weavers training in the school today.",
      duration_minutes: 90,
      time_slot: "Morning",
      base_price: 0,
      currency: "EUR",
      required: true,
      image_url:
        "https://images.unsplash.com/photo-1605557626634-7b4f2b3e9bff?auto=format&fit=crop&w=900&q=80",
      links: [
        { label: "Fondazione Lisio (official site)", url: "https://www.fondazionelisio.org" },
      ],
    },
    {
      id: "seg_tessitura_casini",
      title: "Tessitura LAB Casini Guidotti",
      description:
        "Also included in your GYG booking. A working contemporary studio combining traditional looms with modern design — they weave for fashion houses, theatres, and museums. You'll see how a Florentine archive is reinterpreted into cloth that ships worldwide.",
      duration_minutes: 75,
      time_slot: "Late morning",
      base_price: 0,
      currency: "EUR",
      required: true,
      image_url:
        "https://images.unsplash.com/photo-1604147495798-57beb5d6af73?auto=format&fit=crop&w=900&q=80",
    },
    {
      id: "seg_antico_setificio",
      title: "Antico Setificio Fiorentino",
      description:
        "Optional add-on. Florence's historic silk factory — running 18th-century wooden looms in working condition. Walk the floor, see the warp-winder originally designed by Leonardo da Vinci, and watch craft as it was practiced 250 years ago.",
      duration_minutes: 60,
      time_slot: "Afternoon",
      base_price: 40,
      currency: "EUR",
      required: false,
      image_url:
        "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?auto=format&fit=crop&w=900&q=80",
      links: [
        { label: "Antico Setificio Fiorentino", url: "https://anticosetificiofiorentino.com/" },
      ],
    },
    {
      id: "seg_stefanie_dux",
      title: "Stefanie Dux — independent weaver",
      description:
        "Optional add-on. Stefanie's studio sits in a quiet courtyard outside the Centro. She weaves linen and silk on a single antique loom, taking commissions for fashion designers and collectors. A rare chance to see contemporary independent practice up close.",
      duration_minutes: 60,
      time_slot: "Late afternoon",
      base_price: 60,
      currency: "EUR",
      required: false,
      image_url:
        "https://images.unsplash.com/photo-1596443686116-d0d3b48aa4f4?auto=format&fit=crop&w=900&q=80",
    },
    {
      id: "seg_transport_private",
      title: "Private transfer between sites",
      description:
        "Optional add-on. A driver moves you between the workshops — comfortable, climate-controlled, no maps to read. Recommended if you've added Antico Setificio or Stefanie Dux, since they're outside the historic centre.",
      duration_minutes: null,
      time_slot: null,
      base_price: 30,
      currency: "EUR",
      required: false,
      image_url:
        "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=900&q=80",
    },
    {
      id: "seg_artisan_lunch",
      title: "Artisan lunch with the weavers",
      description:
        "Optional add-on. A long Tuscan lunch — pasta, local wine, conversation that runs as long as the meal. The host weavers join you at the table. Stories you wouldn't get on a tour.",
      duration_minutes: 75,
      time_slot: "Midday",
      base_price: 35,
      currency: "EUR",
      required: false,
      image_url:
        "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=900&q=80",
    },
  ],
} as const

export default async function seedFlorenceTour({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const forms: FormsService = container.resolve(FORMS_MODULE)

  const targetId = process.env.FORM_ID

  let form: any | null = null
  if (targetId) {
    form = await (forms as any).retrieveForm(targetId).catch(() => null)
  } else {
    const [list] = await (forms as any).listAndCountForms(
      { handle: "florence-silk", domain: "jaalyantra.com" },
      { take: 1 }
    )
    form = list?.[0] ?? null
  }

  if (!form) {
    logger.error(
      `No tour form found. Set FORM_ID or create a tour form with handle 'florence-silk'.`
    )
    return
  }

  if (form.type !== "tour") {
    logger.warn(
      `Form ${form.id} has type=${form.type} (not 'tour') — settings will save but the visit wizard won't render until you flip type to 'tour'.`
    )
  }

  const next = {
    ...((form.settings as Record<string, any> | null) || {}),
    ...FLORENCE_SETTINGS,
  }

  await (forms as any).updateForms({ id: form.id, settings: next })

  const placeholderGuides = FLORENCE_SETTINGS.guides.filter(
    (g) => g.availability === "na"
  ).length
  const availableGuides = FLORENCE_SETTINGS.guides.length - placeholderGuides

  logger.info(
    `Seeded ${form.id} (${form.handle}) — ${FLORENCE_SETTINGS.itinerary_segments.length} segments, ${availableGuides} available guide(s), ${placeholderGuides} placeholder guide(s)`
  )
}
