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
}

export interface TemplateSpec {
  name: string
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION"
  languages: TemplateLanguageVariant[]
}

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
