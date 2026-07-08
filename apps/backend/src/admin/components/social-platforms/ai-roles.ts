/**
 * Single source of truth for the *suggested* AI-provider roles surfaced in the
 * admin "Create AI provider" form.
 *
 * Why this exists: the canonical role set used to live in two places that
 * silently drifted — the `AiRole` union in
 * `src/mastra/services/ai-platforms.ts` (resolver side) and a hardcoded
 * `RoleEnum` / `ROLE_LABELS` pair inside `create-ai-platform-component.tsx`
 * (UI side). When #589 added `ai_digest_summary` and #659 added
 * `ai_newsletter_drafter`, only the resolver learned about them — operators
 * couldn't pick them in the UI and had to hand-edit `metadata.role` in the DB.
 *
 * The resolver stays deliberately string-tolerant (`AiRole` has a
 * `(string & {})` escape hatch and resolution is a pure `metadata.role ===
 * role` DB lookup). This module is just the *labelled, suggested* set plus the
 * helpers that let the creator offer a "Custom role…" free-form entry that maps
 * to any new role string without a code change.
 *
 * Keep `KNOWN_AI_ROLES` in sync with the labelled roles in the `AiRole` union;
 * adding a future suggested role is a one-line change here.
 */

export type KnownAiRole = {
  /** The literal stored verbatim into `metadata.role`. */
  value: string
  /** Friendly label shown in the dropdown. */
  label: string
}

export const KNOWN_AI_ROLES: KnownAiRole[] = [
  { value: "ai_search_chat", label: "Storefront search — chat / extraction" },
  { value: "ai_search_embed", label: "Storefront search — embeddings" },
  { value: "ai_product_description", label: "Product image → description" },
  { value: "ai_image_gen", label: "Image generation / segmentation (FAL)" },
  { value: "ai_digest_summary", label: "Partner digest — AI summary" },
  {
    value: "ai_newsletter_drafter",
    label: "Newsletter / Marketing — Write with AI",
  },
  {
    value: "ai_image_extraction",
    label: "Inventory image → items (vision extraction)",
  },
  {
    value: "ai_redesign",
    label: "Moodboard Redesign — Nano-Banana (gemini-2.5-flash-image)",
  },
  {
    value: "ai_theme_editor",
    label: "Theme Editor — LLM chat (#339)",
  },
]

/** Sentinel form value selected when the operator wants a free-form role. */
export const CUSTOM_ROLE_SENTINEL = "__custom__"

/**
 * Valid custom-role slug: lowercase, starts with a letter, then letters /
 * digits / underscores. Mirrors the resolver's expectation that a role is a
 * stable identifier (e.g. `ai_marketing_vp`, `ai_blog_drafter`).
 */
export const ROLE_SLUG_REGEX = /^[a-z][a-z0-9_]+$/

export const KNOWN_ROLE_VALUES: string[] = KNOWN_AI_ROLES.map((r) => r.value)

/** True if `role` is one of the labelled, suggested roles. */
export const isKnownAiRole = (role: string | undefined | null): boolean =>
  !!role && KNOWN_ROLE_VALUES.includes(role)

export const isValidRoleSlug = (slug: string | undefined | null): boolean =>
  !!slug && ROLE_SLUG_REGEX.test(slug)

/**
 * Map a stored `metadata.role` into the creator/edit form's split
 * representation. A known role selects its dropdown option with an empty
 * custom field; an unknown (custom) role selects the sentinel and surfaces the
 * stored value in the custom text input — so editing round-trips instead of
 * showing blank.
 */
export const roleToFormState = (
  storedRole: string | undefined | null
): { role: string; custom_role: string } => {
  if (storedRole && !isKnownAiRole(storedRole)) {
    return { role: CUSTOM_ROLE_SENTINEL, custom_role: storedRole }
  }
  return {
    role: storedRole && isKnownAiRole(storedRole) ? storedRole : KNOWN_ROLE_VALUES[0],
    custom_role: "",
  }
}

/**
 * Resolve the final role string to persist into `metadata.role` from the
 * form's split `{ role, custom_role }` values. When the sentinel is selected,
 * the trimmed custom slug wins; otherwise the chosen known role passes through
 * verbatim.
 */
export const resolveRoleValue = (values: {
  role: string
  custom_role?: string | null
}): string => {
  if (values.role === CUSTOM_ROLE_SENTINEL) {
    return (values.custom_role ?? "").trim()
  }
  return values.role
}
