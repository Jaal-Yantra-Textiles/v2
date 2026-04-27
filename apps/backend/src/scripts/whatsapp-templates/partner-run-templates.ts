/**
 * Canonical WhatsApp template spec for partner production-run notifications.
 *
 * Each entry defines one template *name* with one or more language
 * variants. Meta treats each language as a separate approval so the
 * management script (src/scripts/manage-whatsapp-templates.ts) submits
 * them individually to each configured WABA.
 *
 * Editing rules:
 *   - Body structure (variable count, button count) MUST be identical
 *     across languages on the same template. Meta enforces this.
 *   - When you change wording, Meta re-reviews the template — approval
 *     can take minutes or hours, occasionally longer. Prefer the
 *     sync-new mode in the management script to add a `_v2` suffix and
 *     review alongside the live version.
 *   - Button TITLES are what the webhook delivers when the partner taps
 *     — so the inbound handler (whatsapp-message-handler.ts) must know
 *     every localized title. See BUTTON_TITLE_ACTIONS below.
 */

export type ButtonSpec =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string }

/**
 * Optional media header attached to a template. Templates with a media
 * header are exempt from WhatsApp's 24-hour customer-care window — the
 * primary reason we use them for reminders that need to reach partners
 * who haven't replied recently.
 *
 * Meta needs an `example_url` (publicly accessible) at approval time so
 * its reviewers can preview the rendering. At send time the runtime
 * passes the per-message image as a header parameter; if the runtime
 * doesn't pass one, recipients see the example image.
 *
 * Today only IMAGE is wired through; VIDEO / DOCUMENT extensions slot
 * in at the same `format` field with their respective example URLs.
 */
export type HeaderSpec = {
  format: "IMAGE"
  /**
   * Publicly-reachable URL Meta downloads during template review. Used
   * as the fallback header when the runtime doesn't provide a per-send
   * image parameter. Should point at a representative brand asset.
   */
  example_url: string
}

export interface TemplateLanguageVariant {
  /** BCP-47 / Meta locale code, e.g. "en", "hi", "en_US". */
  language: string
  /**
   * Body with positional placeholders `{{1}}`, `{{2}}`, ... . Meta
   * requires at least one example string per placeholder at approval time.
   */
  body: string
  /**
   * Example values (one per placeholder, same order). Only used for Meta
   * approval — Meta rejects templates without plausible examples.
   */
  examples: string[]
  buttons?: ButtonSpec[]
  /** Optional short footer line. Meta caps at 60 chars. */
  footer?: string
  /**
   * Optional media header. When set, the management script emits a
   * `HEADER` component during template create — making the template
   * eligible for sends outside the 24-hour customer-care window.
   * Same header config typically applies across languages, but it's
   * declared per-variant so language-specific assets are possible.
   */
  header?: HeaderSpec
}

export interface TemplateSpec {
  name: string
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION"
  languages: TemplateLanguageVariant[]
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared header example
//
// The 3 reminder templates share the same example image. Meta downloads this
// URL during template review to render the preview, and falls back to it at
// send time when the runtime doesn't pass a per-message header parameter.
// Override via env so staging can point at a sample asset without editing
// the spec file.
// ──────────────────────────────────────────────────────────────────────────────

const REMINDER_HEADER_EXAMPLE_URL =
  process.env.WHATSAPP_REMINDER_HEADER_EXAMPLE_URL ||
  "https://cicilabel.com/static/whatsapp/reminder-header.jpg"

// ──────────────────────────────────────────────────────────────────────────────
// Template definitions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Sent when a production run is assigned to a partner. The only template
 * with interactive buttons — partners act on it directly from WhatsApp.
 * Button variables aren't supported per-message, so the inbound handler
 * reads `conversation.metadata.pending_run_id` to map a tap to the run.
 */
const TEMPLATE_ASSIGNED: TemplateSpec = {
  name: "jyt_production_run_assigned_v3",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, you have a new production run.\n\n" +
        "*Design:* {{2}}\n" +
        "*Quantity:* {{3}}\n" +
        "*Run ID:* {{4}}\n\n" +
        "Tap a button below to take action.",
      examples: ["Rajesh", "Block Print Kurta", "250", "prun_01ABC"],
      // Meta rejects emoji, variables, newlines or formatting chars inside
      // template QUICK_REPLY buttons (subcode 2388060). Plain text only.
      buttons: [
        { type: "QUICK_REPLY", text: "Accept" },
        { type: "QUICK_REPLY", text: "Decline" },
        { type: "QUICK_REPLY", text: "View" },
      ],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, आपके लिए एक नया प्रोडक्शन रन है।\n\n" +
        "*डिज़ाइन:* {{2}}\n" +
        "*मात्रा:* {{3}}\n" +
        "*रन आईडी:* {{4}}\n\n" +
        "कार्रवाई के लिए नीचे दिए गए बटन पर टैप करें।",
      examples: ["राजेश", "ब्लॉक प्रिंट कुर्ता", "250", "prun_01ABC"],
      buttons: [
        { type: "QUICK_REPLY", text: "स्वीकार करें" },
        { type: "QUICK_REPLY", text: "मना करें" },
        { type: "QUICK_REPLY", text: "देखें" },
      ],
    },
  ],
}

const TEMPLATE_CANCELLED: TemplateSpec = {
  name: "jyt_production_run_cancelled_v3",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      // Meta rejects template bodies with too few words per variable
      // (subcode 2388293) and bodies that end on a variable (2388299).
      // Both fixed here by padding content and adding a trailing line.
      body:
        "Hi {{1}}, we're writing to let you know that production run {{2}} " +
        "for design {{3}} has been cancelled by the production team.\n\n" +
        "*Reason:* {{4}}\n\n" +
        "Please reach out to the admin team if you have any questions " +
        "about this change.",
      examples: ["Rajesh", "prun_01ABC", "Block Print Kurta", "Material shortage"],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, हम आपको सूचित करना चाहते हैं कि प्रोडक्शन रन {{2}} " +
        "(डिज़ाइन: {{3}}) प्रोडक्शन टीम द्वारा रद्द कर दिया गया है।\n\n" +
        "*कारण:* {{4}}\n\n" +
        "इस बदलाव के बारे में कोई प्रश्न होने पर कृपया एडमिन टीम से " +
        "संपर्क करें।",
      examples: ["राजेश", "prun_01ABC", "ब्लॉक प्रिंट कुर्ता", "सामग्री की कमी"],
    },
  ],
}

const TEMPLATE_COMPLETED: TemplateSpec = {
  name: "jyt_production_run_completed_v3",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, production run {{2}} ({{3}}) is marked complete.\n\n" +
        "*Produced quantity:* {{4}}\n\n" +
        "Thanks for the quick turnaround.",
      examples: ["Rajesh", "prun_01ABC", "Block Print Kurta", "245"],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, प्रोडक्शन रन {{2}} ({{3}}) पूरा हो गया है।\n\n" +
        "*उत्पादित मात्रा:* {{4}}\n\n" +
        "त्वरित कार्य के लिए धन्यवाद।",
      examples: ["राजेश", "prun_01ABC", "ब्लॉक प्रिंट कुर्ता", "245"],
    },
  ],
}

/**
 * Reminder fired when a run sits in `status='sent_to_partner'` for >24h
 * without an `accepted_at`. Driven by the scheduled discoverer flow
 * (src/scripts/seed-production-run-reminders-flow.ts) which emits
 * `production_run.reminder_assignment_pending` events.
 *
 * Variables (must stay in this order — the seed maps them positionally):
 *   {{1}} partner name
 *   {{2}} design name
 *   {{3}} run id
 *   {{4}} days since assignment
 *
 * No buttons — keep informational. The IMAGE header carries the design
 * thumbnail at send time, so this single template fully replaces the
 * old "template + send_image follow-up" pair (which kept failing for
 * any partner outside the 24-hour customer-care window — raw media
 * sends are blocked there, but a media-header template is exempt).
 */
const TEMPLATE_REMINDER_PENDING: TemplateSpec = {
  name: "jyt_production_run_reminder_pending_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      header: {
        format: "IMAGE",
        example_url: REMINDER_HEADER_EXAMPLE_URL,
      },
      body:
        "Hi {{1}}, a quick reminder — production run {{3}} for design " +
        "{{2}} has been waiting for your response.\n\n" +
        "*Waiting since:* {{4}} day(s) ago\n\n" +
        "Please open the partner portal and tap Accept or Decline so we " +
        "can plan the next steps. Reply here if you need help.",
      examples: ["Rajesh", "Block Print Kurta", "prun_01ABC", "2"],
    },
    {
      language: "hi",
      header: {
        format: "IMAGE",
        example_url: REMINDER_HEADER_EXAMPLE_URL,
      },
      body:
        "नमस्ते {{1}}, याद दिला रहे हैं — डिज़ाइन {{2}} के लिए प्रोडक्शन " +
        "रन {{3}} अभी भी आपके उत्तर की प्रतीक्षा में है।\n\n" +
        "*प्रतीक्षा अवधि:* {{4}} दिन\n\n" +
        "कृपया पार्टनर पोर्टल खोलें और स्वीकार करें या मना करें पर टैप " +
        "करें ताकि हम अगले कदम तय कर सकें। मदद चाहिए तो यहीं उत्तर दें।",
      examples: ["राजेश", "ब्लॉक प्रिंट कुर्ता", "prun_01ABC", "2"],
    },
  ],
}

/**
 * Reminder fired when `accepted_at` is set but `started_at` is null after
 * 24h. Variables (positional, must match the seed's vars array):
 *   {{1}} partner name
 *   {{2}} design name
 *   {{3}} run id
 *   {{4}} days since acceptance
 */
const TEMPLATE_REMINDER_NOT_STARTED: TemplateSpec = {
  name: "jyt_production_run_reminder_not_started_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      header: {
        format: "IMAGE",
        example_url: REMINDER_HEADER_EXAMPLE_URL,
      },
      body:
        "Hi {{1}}, just checking in — you've accepted production run " +
        "{{3}} for design {{2}}, but we haven't seen it start yet.\n\n" +
        "*Days since acceptance:* {{4}}\n\n" +
        "If you've already begun, please tap Start in the partner portal " +
        "so we can track progress. Reply here if you're blocked on " +
        "anything and the team will help.",
      examples: ["Rajesh", "Block Print Kurta", "prun_01ABC", "2"],
    },
    {
      language: "hi",
      header: {
        format: "IMAGE",
        example_url: REMINDER_HEADER_EXAMPLE_URL,
      },
      body:
        "नमस्ते {{1}}, बस संपर्क कर रहे हैं — आपने डिज़ाइन {{2}} के लिए " +
        "प्रोडक्शन रन {{3}} स्वीकार किया है, लेकिन काम अभी शुरू नहीं " +
        "हुआ है।\n\n" +
        "*स्वीकृति के बाद के दिन:* {{4}}\n\n" +
        "यदि आप पहले से शुरू कर चुके हैं, तो कृपया पार्टनर पोर्टल में " +
        "Start (शुरू करें) पर टैप करें ताकि हम प्रगति ट्रैक कर सकें। " +
        "कोई बाधा हो तो यहीं उत्तर दें, टीम मदद करेगी।",
      examples: ["राजेश", "ब्लॉक प्रिंट कुर्ता", "prun_01ABC", "2"],
    },
  ],
}

/**
 * Reminder fired when `status='in_progress'` but no produced-quantity
 * activity for >72h. Variables (positional, must match the seed's vars
 * array):
 *   {{1}} partner name
 *   {{2}} design name
 *   {{3}} run id
 *   {{4}} produced quantity (so far)
 *   {{5}} total / target quantity
 */
const TEMPLATE_REMINDER_IDLE: TemplateSpec = {
  name: "jyt_production_run_reminder_idle_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      header: {
        format: "IMAGE",
        example_url: REMINDER_HEADER_EXAMPLE_URL,
      },
      body:
        "Hi {{1}}, checking in on production run {{3}} for design {{2}} " +
        "— it's been quiet for a few days.\n\n" +
        "*Progress:* {{4}} of {{5}} pieces produced\n\n" +
        "Please log a fresh produced-quantity update in the partner " +
        "portal so we know where things stand. Reply here if you're " +
        "blocked and the team will help.",
      examples: ["Rajesh", "Block Print Kurta", "prun_01ABC", "120", "250"],
    },
    {
      language: "hi",
      header: {
        format: "IMAGE",
        example_url: REMINDER_HEADER_EXAMPLE_URL,
      },
      body:
        "नमस्ते {{1}}, डिज़ाइन {{2}} के लिए प्रोडक्शन रन {{3}} पर अपडेट " +
        "चाहिए — कुछ दिनों से कोई गतिविधि नहीं है।\n\n" +
        "*प्रगति:* {{5}} में से {{4}} पीस पूरे\n\n" +
        "कृपया पार्टनर पोर्टल में ताज़ा उत्पादित मात्रा अपडेट दर्ज करें " +
        "ताकि हमें वर्तमान स्थिति का पता चले। कोई बाधा हो तो यहीं उत्तर " +
        "दें, टीम मदद करेगी।",
      examples: ["राजेश", "ब्लॉक प्रिंट कुर्ता", "prun_01ABC", "120", "250"],
    },
  ],
}

/**
 * The very first message a partner gets — fired from the admin UI's
 * "Connect on WhatsApp" button (src/api/admin/partners/[id]/whatsapp-verify).
 * Keep deliberately generic — this is the conversation opener; the partner
 * consent/language flow takes over once they reply.
 *
 * No buttons (Meta treats onboarding buttons as marketing on a lot of
 * accounts, and the consent flow asks its own interactive question once
 * the window opens). Two variables: partner name + business name.
 */
const TEMPLATE_PARTNER_WELCOME: TemplateSpec = {
  name: "jyt_partner_welcome_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, welcome to {{2}}'s partner network on WhatsApp. " +
        "We'll use this number to keep you updated on production runs " +
        "and coordinate work.\n\n" +
        "Please reply to this message so we can confirm your connection.",
      examples: ["Rajesh", "JYT Textiles"],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, व्हाट्सएप पर {{2}} के पार्टनर नेटवर्क में आपका स्वागत है। " +
        "हम इस नंबर का उपयोग आपको प्रोडक्शन रन के अपडेट भेजने और काम के समन्वय " +
        "के लिए करेंगे।\n\n" +
        "कृपया इस संदेश का उत्तर दें ताकि हम आपका कनेक्शन पुष्ट कर सकें।",
      examples: ["राजेश", "JYT Textiles"],
    },
  ],
}

export const PARTNER_RUN_TEMPLATES: TemplateSpec[] = [
  TEMPLATE_PARTNER_WELCOME,
  TEMPLATE_ASSIGNED,
  TEMPLATE_CANCELLED,
  TEMPLATE_COMPLETED,
  TEMPLATE_REMINDER_PENDING,
  TEMPLATE_REMINDER_NOT_STARTED,
  TEMPLATE_REMINDER_IDLE,
]

/**
 * Canonical template-name constants consumed by routes/subscribers that
 * need to reference specific templates by name. Importing from here means
 * when we bump a suffix (e.g. welcome_v1 → welcome_v2) the caller just
 * recompiles — no sed across the repo.
 */
export const TEMPLATE_NAMES = {
  PARTNER_WELCOME: TEMPLATE_PARTNER_WELCOME.name,
  RUN_ASSIGNED: TEMPLATE_ASSIGNED.name,
  RUN_CANCELLED: TEMPLATE_CANCELLED.name,
  RUN_COMPLETED: TEMPLATE_COMPLETED.name,
  RUN_REMINDER_PENDING: TEMPLATE_REMINDER_PENDING.name,
  RUN_REMINDER_NOT_STARTED: TEMPLATE_REMINDER_NOT_STARTED.name,
  RUN_REMINDER_IDLE: TEMPLATE_REMINDER_IDLE.name,
} as const

// ──────────────────────────────────────────────────────────────────────────────
// Button-title → action map
//
// Quick-reply buttons in approved templates arrive on the webhook as their
// localized display text (not a stable id). The inbound handler reads this
// map to translate "✅ स्वीकार करें" → "accept" regardless of language.
//
// Keep in sync with the `buttons` arrays above — every button title must
// appear here or the handler won't know what to do with a tap.
// ──────────────────────────────────────────────────────────────────────────────

export const BUTTON_TITLE_ACTIONS: Record<string, "accept" | "decline" | "view"> = {
  // Template buttons (Meta strips any emoji/formatting anyway)
  "Accept": "accept",
  "Decline": "decline",
  "View": "view",
  "स्वीकार करें": "accept",
  "मना करें": "decline",
  "देखें": "view",
  // Legacy emoji variants — kept so taps on older interactive (non-template)
  // messages built via sendProductionRunAssignment still route correctly.
  // Those messages carry explicit ids so this map isn't usually consulted,
  // but there's no cost to having both spellings.
  "✅ Accept": "accept",
  "✖️ Decline": "decline",
  "📄 View": "view",
  "✅ स्वीकार करें": "accept",
  "✖️ मना करें": "decline",
  "📄 देखें": "view",
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-platform language policy
//
// Governs which language variants get submitted to each WABA when the
// management script runs. Defaults heuristic:
//   - any platform whose country_codes include "+91" → [en, hi]
//   - every other platform                           → [en]
//
// Override per environment with WHATSAPP_PLATFORM_LANGUAGES, e.g.
//   WHATSAPP_PLATFORM_LANGUAGES="AU=en;IN=en,hi;Europe=en,it"
// matched against platform.api_config.label (case-insensitive).
// ──────────────────────────────────────────────────────────────────────────────

export function languagesForPlatform(platform: any): string[] {
  const override = process.env.WHATSAPP_PLATFORM_LANGUAGES
  if (override) {
    const label = (platform?.api_config?.label ?? "").toLowerCase()
    for (const chunk of override.split(";")) {
      const [k, v] = chunk.split("=").map((s) => s.trim())
      if (k && v && k.toLowerCase() === label) {
        return v.split(",").map((l) => l.trim()).filter(Boolean)
      }
    }
  }

  const codes: string[] = Array.isArray(platform?.api_config?.country_codes)
    ? platform.api_config.country_codes
    : []

  if (codes.some((c: string) => c.startsWith("+91"))) {
    return ["en", "hi"]
  }
  return ["en"]
}
