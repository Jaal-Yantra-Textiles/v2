/**
 * Turning a photographed ID card into a person we can create.
 *
 * ## Why the pure half lives here
 *
 * The vision call is a network round trip whose output is a model's best guess.
 * Everything that decides what we KEEP from that guess — what is trusted, what
 * is stored, what is thrown away — is pure and lives here, so the policy can be
 * tested without a model and read without tracing a workflow.
 *
 * ## 🔴 The ID number is deliberately not stored in full
 *
 * These cards are Aadhaar, PAN, passports, driving licences. An Aadhaar number
 * in particular is regulated: the UIDAI regulations require it to be redacted
 * to the last four digits wherever it is displayed or retained by an entity
 * that is not doing authenticated e-KYC, and we are not. A photo of a card is
 * also not proof of anything — nothing here is verification.
 *
 * So the default is `mask`: we keep the ID TYPE, the last four digits, and
 * nothing else. That is enough to say "this artisan was onboarded against a
 * PAN ending 4021" and not enough to be a breach. A caller may pass
 * `id_number_policy: "discard"` to keep even less. There is deliberately no
 * option to store the full number — if that is ever needed it should arrive
 * with a retention policy and an encrypted column, not as a flag on an
 * extraction tool.
 *
 * ⚠️ The raw number therefore must never be echoed back in a response either,
 * because a preview response is exactly what an operator pastes into a chat log.
 */

/** What the vision model is asked to return. Kept next to the parser it feeds. */
export const ID_CARD_SYSTEM_PROMPT = [
  "You read a photograph of a government identity document and return JSON only, no prose.",
  "",
  "Return this shape, using null for anything the image does not clearly show:",
  "{",
  '  "first_name": string|null,',
  '  "last_name": string|null,',
  '  "date_of_birth": string|null,   // ISO 8601 date, YYYY-MM-DD',
  '  "gender": string|null,',
  '  "id_type": string|null,         // one of: aadhaar, pan, passport, driving_licence, voter_id, other',
  '  "id_number": string|null,',
  '  "address": {',
  '    "street": string|null, "city": string|null, "state": string|null,',
  '    "postal_code": string|null, "country": string|null',
  "  }|null,",
  '  "confidence": number            // 0..1, your own confidence in the whole reading',
  "}",
  "",
  "Rules:",
  "- Transcribe exactly what is printed. Do not translate, expand initials, or correct spellings.",
  "- A name printed as one field goes entirely in first_name and last_name is null. Never invent a surname.",
  "- If the document is not an identity document, or is too blurred to read, return every field null with confidence 0.",
  "- Never guess a date of birth from an age or a photograph.",
].join("\n")

export type IdNumberPolicy = "mask" | "discard"

export type IdCardAddress = {
  street: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
}

export type PersonDraft = {
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  gender: string | null
  id_type: string | null
  /** Last four digits only, e.g. `••••4021`. Never the full number. */
  id_number_masked: string | null
  id_last4: string | null
  address: IdCardAddress | null
  confidence: number
  /**
   * Everything a human should look at before pressing create. Empty means the
   * reading was complete and internally consistent — never that it is correct.
   */
  warnings: string[]
  /** False when the draft must not be persisted without a human fixing it first. */
  creatable: boolean
}

const ID_TYPES = [
  "aadhaar",
  "pan",
  "passport",
  "driving_licence",
  "voter_id",
  "other",
] as const

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length ? t : null
}

/**
 * `YYYY-MM-DD` only, and it must be a real, past, plausible date.
 *
 * 🔑 Rejecting rather than coercing. `new Date("31/12/1980")` is `Invalid Date`
 * in Node but `new Date("2024-13-45")` silently rolls over into 2025 — a
 * coerced date of birth is a wrong fact that looks like a right one, and this
 * one ends up on a person record nobody re-checks.
 */
export const parseDateOfBirth = (
  v: unknown
): { value: string | null; warning: string | null } => {
  const raw = str(v)
  if (!raw) return { value: null, warning: null }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return {
      value: null,
      warning: `date_of_birth "${raw}" is not an ISO date (YYYY-MM-DD) and was dropped rather than guessed at.`,
    }
  }

  const [y, m, d] = raw.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const rolledOver =
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d

  if (Number.isNaN(dt.getTime()) || rolledOver) {
    return {
      value: null,
      warning: `date_of_birth "${raw}" is not a real calendar date and was dropped.`,
    }
  }

  const now = Date.now()
  if (dt.getTime() > now) {
    return {
      value: null,
      warning: `date_of_birth "${raw}" is in the future and was dropped.`,
    }
  }
  // 120 years. Older than this is a misread century far more often than a
  // supercentenarian artisan.
  if (now - dt.getTime() > 120 * 365.25 * 24 * 60 * 60 * 1000) {
    return {
      value: null,
      warning: `date_of_birth "${raw}" is more than 120 years ago and was dropped as a likely misread.`,
    }
  }

  return { value: raw, warning: null }
}

/**
 * Keep the last four digits and nothing else.
 *
 * Digits are counted after stripping separators, because cards print Aadhaar as
 * `1234 5678 9012` and a naive `slice(-4)` on the raw string can return
 * `9012` or ` 012` depending on trailing whitespace.
 */
export const maskIdNumber = (
  v: unknown,
  policy: IdNumberPolicy
): { masked: string | null; last4: string | null; warning: string | null } => {
  const raw = str(v)
  if (!raw) return { masked: null, last4: null, warning: null }

  if (policy === "discard") {
    return { masked: null, last4: null, warning: null }
  }

  const alnum = raw.replace(/[^0-9a-zA-Z]/g, "")
  if (alnum.length < 4) {
    return {
      masked: null,
      last4: null,
      warning:
        "id_number was too short to be a real document number and was discarded.",
    }
  }

  const last4 = alnum.slice(-4)
  return { masked: `••••${last4}`, last4, warning: null }
}

const normaliseAddress = (v: unknown): IdCardAddress | null => {
  if (!v || typeof v !== "object") return null
  const a = v as Record<string, unknown>
  const out: IdCardAddress = {
    street: str(a.street),
    city: str(a.city),
    state: str(a.state),
    postal_code: str(a.postal_code),
    country: str(a.country),
  }
  // An address of five nulls is not an address.
  return Object.values(out).some((x) => x !== null) ? out : null
}

const normaliseIdType = (v: unknown): { type: string | null; warning: string | null } => {
  const raw = str(v)?.toLowerCase().replace(/[\s-]+/g, "_")
  if (!raw) return { type: null, warning: null }
  if ((ID_TYPES as readonly string[]).includes(raw)) return { type: raw, warning: null }
  return {
    type: "other",
    warning: `id_type "${raw}" is not one we recognise; recorded as "other".`,
  }
}

const clampConfidence = (v: unknown): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Normalise one raw vision reading into a person draft.
 *
 * PURE. Every decision about what survives the model's guess is made here.
 */
export const normaliseIdCardExtraction = (
  raw: unknown,
  opts: { id_number_policy?: IdNumberPolicy } = {}
): PersonDraft => {
  const policy: IdNumberPolicy = opts.id_number_policy ?? "mask"
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>

  const warnings: string[] = []

  const first_name = str(r.first_name)
  const last_name = str(r.last_name)

  const dob = parseDateOfBirth(r.date_of_birth)
  if (dob.warning) warnings.push(dob.warning)

  const idType = normaliseIdType(r.id_type)
  if (idType.warning) warnings.push(idType.warning)

  const id = maskIdNumber(r.id_number, policy)
  if (id.warning) warnings.push(id.warning)

  const confidence = clampConfidence(r.confidence)

  /**
   * 🔴 A person with no name is not a person. This is the one hard refusal:
   * everything else on a card can be missing and the record still means
   * something, but a nameless row is landfill that someone will later try to
   * match against a real human.
   */
  const hasName = Boolean(first_name || last_name)
  if (!hasName) {
    warnings.push(
      "No name could be read from the image, so no person can be created from it."
    )
  }

  if (confidence < 0.5 && hasName) {
    warnings.push(
      `The model's own confidence in this reading is ${confidence.toFixed(
        2
      )}. Check every field against the card before creating.`
    )
  }

  if (!last_name && first_name) {
    warnings.push(
      "Only one name field was printed. It has been kept whole as the first name rather than split into a surname."
    )
  }

  return {
    first_name,
    last_name,
    date_of_birth: dob.value,
    gender: str(r.gender),
    id_type: idType.type,
    id_number_masked: id.masked,
    id_last4: id.last4,
    address: normaliseAddress(r.address),
    confidence,
    warnings,
    creatable: hasName,
  }
}

/**
 * The person payload to create, derived from a draft.
 *
 * ⚠️ `email` is deliberately absent. `person.email` is UNIQUE and an ID card
 * carries no email, so inventing one (`aadhaar-4021@…`) to satisfy a form would
 * collide across cards and poison the uniqueness constraint for real addresses.
 * Null is the honest value.
 */
export const personCreateInputFromDraft = (
  draft: PersonDraft,
  extra: { source_image_url?: string | null; created_via?: string } = {}
) => {
  if (!draft.creatable) {
    throw new Error(
      "Refusing to build a person from a draft with no name — see draft.warnings."
    )
  }

  return {
    first_name: draft.first_name ?? "",
    last_name: draft.last_name ?? "",
    date_of_birth: draft.date_of_birth ? new Date(draft.date_of_birth) : null,
    metadata: {
      // Provenance, so anyone looking at this row later knows a machine read it
      // off a photograph and that nothing here was verified.
      created_via: extra.created_via ?? "id_card_extraction",
      id_document: {
        type: draft.id_type,
        last4: draft.id_last4,
        masked: draft.id_number_masked,
        verified: false,
      },
      ...(draft.gender ? { gender: draft.gender } : {}),
      ...(extra.source_image_url ? { source_image_url: extra.source_image_url } : {}),
      extraction_confidence: draft.confidence,
    },
  }
}
