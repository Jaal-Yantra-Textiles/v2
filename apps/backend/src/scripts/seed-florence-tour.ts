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
 * Source of truth for the listing copy:
 * https://www.getyourguide.com/florence-l32/florence-silk-weaving-workshop-and-factory-tour-t1182610/
 *
 * Run:
 *   FORM_ID=form_01KQH52ECNWE1AFV0814VKTMCW \
 *     npx medusa exec ./src/scripts/seed-florence-tour.ts
 *
 * If FORM_ID is omitted the script falls back to the form whose
 * handle is `florence-silk` on the jaalyantra.com domain.
 *
 * To target prod, point DATABASE_URL at the prod URL before running:
 *   DATABASE_URL=$PROD_DATABASE_URL FORM_ID=… npx medusa exec ./src/scripts/seed-florence-tour.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomBytes } from "crypto"
import { FORMS_MODULE } from "../modules/forms"
import FormsService from "../modules/forms/service"

/** 32-byte url-safe token. Compatible with the public route's >= 16 char check. */
const mintToken = (): string => randomBytes(32).toString("base64url")

const FLORENCE_SETTINGS = {
  story: {
    headline: "A craft journey through Florence, told at your pace.",
    body:
      "Begin at Fondazione Arte della Seta Lisio — one of the last remaining workshops in the world to use original 18th-century looms — and hear the rhythmic clack of the shuttles alongside the legendary warping machine designed by Leonardo da Vinci. Then move on to Tessitura LAB Casini Guidotti, where you'll witness the technical pinnacle of the craft: hand-woven velvets and brocades made with real gold and silver threads. Both are included in your GetYourGuide booking. If you'd like more, add Antico Setificio Fiorentino — Florence's historic silk factory — to round the day out.",
  },
  // Guide tokens are minted at seed time when missing — never committed.
  // Re-running the seed preserves any existing token in DB so guides keep
  // their existing /guides/<token> URLs.
  guides: [
    {
      id: "alessandra",
      name: "Alessandra Bianca L'Abate",
      role: "Textile activist & weaving guide",
      bio:
        "Born in Florence and trained as a weaver in the Florentine tradition, Alessandra is a self-professed \"textile activist\" who has dedicated her life to raising public awareness of the role of textiles in our lives.",
      photo_url: null,
      languages: ["English", "Italian"],
      instagram: null,
      availability: "available" as const,
    },
    {
      id: "saransh",
      name: "Saransh Sharma",
      role: "Organizer & weaver",
      bio:
        "A fluent English speaker and a weaver himself who runs his own fashion business — Saransh bridges the gap between historic craft and modern application. He guides the hands-on portion of the day, drawing the line from the great Florentine setifici to today's artisan-entrepreneurs.",
      photo_url: null,
      languages: ["English", "Hindi"],
      instagram: null,
      availability: "available" as const,
    },
  ],
  pricing: {
    currency: "EUR",
    per_category_multiplier: { Adult: 1, Child: 0.5, Senior: 1 },
  },
  practical_guidance: {
    meeting_point:
      "Pickup at Ditta Artigianale (Via dei Neri Specialty Coffee Shop) or near the Uffizi Galleries — your guide will confirm the exact spot 24h before. Drop-off at the same two locations at the end of the 3-hour tour.",
    what_to_wear:
      "Comfortable clothes you don't mind getting a little dye-spotted, and shoes you can stand and walk in for extended periods.",
    what_we_provide:
      "Your guide, the workshop visits, and hands-on instruction. Group is capped at 6 so you'll get genuine face-time with the weavers.",
    what_to_bring:
      "A reusable water bottle, a camera if you'd like (please respect each weaver's preference), and the cost of foundation entrance tickets — these are paid directly to Lisio + Tessitura LAB on the day, not via GetYourGuide.",
  },
  // Customer-facing notes about what's NOT covered. Surfaced separately
  // from add-ons so people don't confuse "you can pay for this" (add-on)
  // with "you'll pay for this elsewhere" (excluded).
  excluded: [
    "Transportation to and from the activity location",
    "Meals and drinks during the day",
    "Foundation entrance tickets for Tessitura LAB Casini Guidotti & Fondazione Arte della Seta Lisio (paid directly on the day)",
  ],
  highlights: [
    "Feel the raw textures of Tuscan wool, organic linen, and cultivated silk",
    "Learn the difference between the warp and weft threads in weaving",
    "Sit at a traditional manual frame loom and weave your own fabric",
    "Visit the Antico Setificio Fiorentino and see 18th-century looms",
    "See hand-woven velvets and brocades made with real gold and silver threads",
  ],
  // High-trust signals lifted from the GYG listing — the wizard surfaces
  // these as small chips on the welcome step.
  trust_signals: {
    duration: "3 hours",
    group_cap: 6,
    languages: ["English"],
    wheelchair_accessible: true,
    free_cancellation_hours: 24,
    pay_later: true,
  },
  itinerary_segments: [
    // NOTE on image URLs: the URLs below are partner-hosted assets sourced
    // from the official sites of Lisio + Antico Setificio. They render
    // correctly in production but you should download + re-upload to your
    // own bucket before broad launch — partner CDNs can change paths
    // without notice, and self-hosting protects against link-rot.
    {
      id: "seg_lisio",
      title: "Fondazione Arte della Seta Lisio",
      description:
        "One of the last remaining workshops in the world to use original 18th-century looms. Hear the rhythmic 'clack-clack' of the shuttles, see the legendary warping machine designed by Leonardo da Vinci in action, and meet the apprentice weavers training in the school today. Included in your GetYourGuide booking.",
      duration_minutes: 90,
      time_slot: "Morning",
      base_price: 0,
      currency: "EUR",
      required: true,
      image_url:
        "https://www.datocms-assets.com/2305/1567424391-fondazione-lisio-photo-stefano-casati-7510.jpg",
      location: {
        address: "Via Benedetto Fortini 143, 50125 Firenze FI, Italy",
        lat: 43.7569,
        lng: 11.2885,
      },
      links: [
        { label: "Fondazione Lisio (official site)", url: "https://www.fondazionelisio.org" },
      ],
    },
    {
      id: "seg_tessitura_casini",
      title: "Tessitura LAB Casini Guidotti",
      description:
        "The technical pinnacle of the craft: hand-woven velvets and brocades made with real gold and silver threads — a testament to centuries of opulent artistry. Tessitura LAB combines traditional looms with modern design, weaving for fashion houses, theatres, and museums. Included in your GetYourGuide booking.",
      duration_minutes: 90,
      time_slot: "Late morning",
      base_price: 0,
      currency: "EUR",
      required: true,
      // Tessitura LAB doesn't have a discoverable public site at the time of
      // seeding — leaving image_url null falls back to the wizard's gradient
      // placeholder. Update via admin once their photo is in your S3 bucket.
      image_url: null,
      location: {
        address:
          "Atelier di Tessitura Casini Guidotti, Via del Casone 1/R, angolo Viale Petrarca, 50124 Firenze FI, Italy",
        lat: 43.7677,
        lng: 11.2398,
      },
    },
    {
      id: "seg_antico_setificio",
      title: "Antico Setificio Fiorentino",
      description:
        "Optional add-on. Florence's historic silk factory — running 18th-century wooden looms in working condition. Walk the floor, see the warp-winder originally designed by Leonardo da Vinci, and watch craft as it was practiced 250 years ago. A 40-minute guided visit; ideal if you want to round the day out beyond the two included foundation tours.",
      duration_minutes: 40,
      time_slot: "Afternoon",
      base_price: 120,
      currency: "EUR",
      required: false,
      image_url:
        "https://anticosetificiofiorentino.com/media/contents/tradizione-arte-seta.jpg",
      location: {
        address: "Via L. Bartolini 4, 50124 Firenze FI, Italy",
        lat: 43.7706,
        lng: 11.2392,
      },
      links: [
        { label: "Antico Setificio Fiorentino", url: "https://anticosetificiofiorentino.com/" },
      ],
    },
    {
      id: "seg_stefanie_dux",
      title: "Stefanie Dux — independent weaver",
      description:
        "Optional add-on. A small, intimate textile studio outside the historic centre. Stefanie's practice spans hand weaving, natural dyeing, and manual spinning of Italian wool, hemp, linen, silk, and cotton. You'll see how she turns those fibres into fashion, accessories, and home textiles on a single antique loom — a rare chance to meet a contemporary independent weaver up close.",
      duration_minutes: 60,
      time_slot: "Late afternoon",
      base_price: 60,
      currency: "EUR",
      required: false,
      image_url: null,
      location: {
        address: "Studio outside Centro Storico — exact address shared by your guide before the visit.",
      },
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

  // Preserve existing guide tokens so the /guides/<token> URLs stay valid
  // across re-seeds. Mint a fresh token only when one doesn't already exist.
  const existingGuides: Array<{ id?: string; access_token?: string }> = Array.isArray(
    (form.settings as any)?.guides
  )
    ? (form.settings as any).guides
    : []
  const existingTokenById = new Map<string, string>()
  for (const g of existingGuides) {
    if (g?.id && typeof g.access_token === "string" && g.access_token) {
      existingTokenById.set(g.id, g.access_token)
    }
  }

  const guidesWithTokens = FLORENCE_SETTINGS.guides.map((g) => ({
    ...g,
    access_token: existingTokenById.get(g.id) || mintToken(),
  }))

  const next = {
    ...((form.settings as Record<string, any> | null) || {}),
    ...FLORENCE_SETTINGS,
    guides: guidesWithTokens,
  }

  await (forms as any).updateForms({ id: form.id, settings: next })

  // Surface the tokens once so operators can copy them on first seed; on
  // re-seeds the same lines just confirm the existing URLs are unchanged.
  for (const g of guidesWithTokens) {
    logger.info(
      `  guide ${g.id} (${g.name}) → /guides/${g.access_token}`
    )
  }

  const placeholderGuides = (FLORENCE_SETTINGS.guides as ReadonlyArray<{ availability: string }>)
    .filter((g) => g.availability === "na")
    .length
  const availableGuides = FLORENCE_SETTINGS.guides.length - placeholderGuides

  logger.info(
    `Seeded ${form.id} (${form.handle}) — ${FLORENCE_SETTINGS.itinerary_segments.length} segments, ${availableGuides} available guide(s), ${placeholderGuides} placeholder guide(s)`
  )
}
