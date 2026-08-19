/**
 * CRM activity + engagement vocabulary, and the PURE derivation that turns a
 * contact's activity history into "where is this conversation right now".
 *
 * Like `./stages`, this file has NO imports — the admin timeline needs these
 * constants in the browser, and reaching them through the contract would pull
 * the hypercore stack into a Vite bundle.
 *
 * ## Two axes that are deliberately NOT the same thing
 *
 *   - `crm_opportunity.stage`   — where the DEAL is (see ./stages)
 *   - `crm_person.engagement_state` — where the CONVERSATION is
 *
 * They move independently and conflating them is the usual CRM modelling
 * mistake. A deal can sit at `quoted` while the contact has gone quiet; a
 * chatty contact may have no deal at all. Flows care about the conversation
 * axis, reporting cares about the deal axis.
 *
 * ## Why the state is derived rather than hand-set
 *
 * Every value below is a function of the activity log plus the clock, so it
 * cannot drift from what actually happened. A stored-and-hand-edited state is
 * exactly the field that ends up saying `awaiting_reply` about somebody who
 * replied three weeks ago. It IS persisted on the contact — but only ever
 * written by `deriveEngagement`, so the stored value is a cache of the
 * derivation, never an independent source of truth.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Coarse classifier. Add values as new sources start writing activities. */
export const CRM_ACTIVITY_TYPES = [
  "message",
  "call",
  "meeting",
  "note",
  "lifecycle",
  "system",
] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

/**
 * Who moved. `internal` is for things that happened on our side without
 * reaching the contact (a note, a stage change) — keeping those out of
 * inbound/outbound is what makes "have they replied?" answerable.
 */
export const CRM_ACTIVITY_DIRECTIONS = [
  "inbound",
  "outbound",
  "internal",
] as const;
export type CrmActivityDirection = (typeof CRM_ACTIVITY_DIRECTIONS)[number];

export const CRM_ACTIVITY_CHANNELS = [
  "whatsapp",
  "email",
  "phone",
  "instagram",
  "facebook",
  "in_person",
  "other",
] as const;
export type CrmActivityChannel = (typeof CRM_ACTIVITY_CHANNELS)[number];

/**
 * Delivery/response outcome. Distinct from the messaging module's own status:
 * this records what the activity MEANT for the relationship, while
 * `messaging_message.status` records what the transport did. Correlate the two
 * through `message_id` rather than copying one into the other.
 */
export const CRM_ACTIVITY_OUTCOMES = [
  "pending",
  "delivered",
  "replied",
  "no_answer",
  "bounced",
  "failed",
] as const;
export type CrmActivityOutcome = (typeof CRM_ACTIVITY_OUTCOMES)[number];

/** What a CRM activity can be attached to. */
export const CRM_ACTIVITY_RELATED_TYPES = [
  "person",
  "company",
  "opportunity",
] as const;
export type CrmActivityRelatedType =
  (typeof CRM_ACTIVITY_RELATED_TYPES)[number];

/** Where the CONVERSATION is. Not where the deal is. */
export const CRM_ENGAGEMENT_STATES = [
  "not_contacted",
  "awaiting_reply",
  "in_conversation",
  "follow_up_due",
  "stalled",
  "do_not_contact",
  "closed",
] as const;
export type CrmEngagementState = (typeof CRM_ENGAGEMENT_STATES)[number];

export const CRM_ENGAGEMENT_DEFAULT_STATE: CrmEngagementState = "not_contacted";

export const CRM_ENGAGEMENT_LABELS: Record<CrmEngagementState, string> = {
  not_contacted: "Not contacted",
  awaiting_reply: "Awaiting reply",
  in_conversation: "In conversation",
  follow_up_due: "Follow-up due",
  stalled: "Stalled",
  do_not_contact: "Do not contact",
  closed: "Closed",
};

export const CRM_ENGAGEMENT_HINTS: Record<CrmEngagementState, string> = {
  not_contacted: "Nobody has reached out yet",
  awaiting_reply: "We reached out — the ball is in their court",
  in_conversation: "They replied; the conversation is live",
  follow_up_due: "A scheduled follow-up has come due",
  stalled: "Repeated outreach, no answer",
  do_not_contact: "Opted out — do not contact",
  closed: "Conversation deliberately ended",
};

/**
 * States a flow should never message into.
 *
 * `do_not_contact` is a compliance boundary, not a preference: it is checked by
 * `isContactable` and every send path must consult it. `closed` is our own
 * decision to stop. Both are terminal for automation but a human can still act
 * deliberately.
 */
export const CRM_ENGAGEMENT_UNCONTACTABLE: readonly CrmEngagementState[] = [
  "do_not_contact",
  "closed",
];

export const isContactable = (state?: string | null): boolean =>
  !(CRM_ENGAGEMENT_UNCONTACTABLE as readonly string[]).includes(
    String(state ?? CRM_ENGAGEMENT_DEFAULT_STATE)
  );

/** States that mean somebody owes this contact an action right now. */
export const CRM_ENGAGEMENT_NEEDS_ACTION: readonly CrmEngagementState[] = [
  "not_contacted",
  "follow_up_due",
];

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** The fields of a `crm_activity` the derivation actually reads. */
export type EngagementActivity = {
  direction?: string | null;
  activity_type?: string | null;
  kind?: string | null;
  occurred_at?: string | null;
  channel?: string | null;
};

export type EngagementPolicy = {
  /** Outbound attempts with no inbound before a contact counts as stalled. */
  maxAttempts: number;
  /** …and this long since the last one. Both must hold. */
  stallAfterDays: number;
  /** Default gap used when scheduling a follow-up with no explicit date. */
  defaultFollowUpDays: number;
};

export const DEFAULT_ENGAGEMENT_POLICY: EngagementPolicy = {
  maxAttempts: 3,
  stallAfterDays: 14,
  defaultFollowUpDays: 3,
};

export type EngagementSnapshot = {
  engagement_state: CrmEngagementState;
  last_activity_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  /** Outbound attempts since the most recent inbound. Resets when they reply. */
  outbound_attempts: number;
  next_follow_up_at: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toTime = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/** `kind` values that force a terminal state regardless of anything else. */
const OPT_OUT_KINDS = new Set(["opt_out", "unsubscribed", "do_not_contact"]);
const CLOSE_KINDS = new Set(["closed", "conversation_closed"]);

/**
 * Derive the whole engagement snapshot for one contact.
 *
 * `activities` may arrive in any order — they are sorted here rather than
 * trusting the caller, because the CRM's list endpoint has no ordering
 * guarantee and a mis-ordered log would silently invert "who spoke last",
 * which is the single fact everything below turns on.
 *
 * `now` is injected rather than read from the clock so this stays pure and the
 * time-dependent transitions are testable without waiting fourteen days.
 */
export function deriveEngagement(
  activities: EngagementActivity[],
  opts: {
    now: Date | string | number;
    /** An explicitly scheduled follow-up, if one is set on the contact. */
    scheduledFollowUpAt?: string | null;
    policy?: EngagementPolicy;
  }
): EngagementSnapshot {
  const policy = opts.policy ?? DEFAULT_ENGAGEMENT_POLICY;
  const now =
    opts.now instanceof Date
      ? opts.now.getTime()
      : typeof opts.now === "number"
        ? opts.now
        : new Date(opts.now).getTime();

  const sorted = [...activities]
    .filter((a) => toTime(a.occurred_at) !== null)
    .sort((a, b) => (toTime(a.occurred_at) ?? 0) - (toTime(b.occurred_at) ?? 0));

  let lastInbound: number | null = null;
  let lastOutbound: number | null = null;
  let lastAny: number | null = null;
  let optedOut = false;
  let closed = false;

  for (const a of sorted) {
    const t = toTime(a.occurred_at)!;
    lastAny = t;
    const kind = String(a.kind ?? "").toLowerCase();
    if (OPT_OUT_KINDS.has(kind)) optedOut = true;
    if (CLOSE_KINDS.has(kind)) closed = true;
    // A later re-engagement reopens a closed conversation, but NEVER an
    // opt-out: consent has to be given again explicitly, not inferred from
    // somebody sending another message.
    if (a.direction === "inbound") {
      lastInbound = t;
      closed = false;
    }
    if (a.direction === "outbound") lastOutbound = t;
  }

  // Outbound attempts since the last reply — the count that decides "stalled".
  let attempts = 0;
  for (const a of sorted) {
    const t = toTime(a.occurred_at)!;
    if (a.direction !== "outbound") continue;
    if (lastInbound !== null && t <= lastInbound) continue;
    attempts++;
  }

  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
  const scheduled = toTime(opts.scheduledFollowUpAt);

  const base = {
    last_activity_at: iso(lastAny),
    last_inbound_at: iso(lastInbound),
    last_outbound_at: iso(lastOutbound),
    outbound_attempts: attempts,
    next_follow_up_at: opts.scheduledFollowUpAt ?? null,
  };

  // Terminal states first — they outrank every time-based transition.
  if (optedOut) {
    return { ...base, engagement_state: "do_not_contact", next_follow_up_at: null };
  }
  if (closed) {
    return { ...base, engagement_state: "closed", next_follow_up_at: null };
  }

  if (lastOutbound === null && lastInbound === null) {
    return { ...base, engagement_state: "not_contacted" };
  }

  // They spoke last (or an inbound arrived with no outreach at all — an
  // enquiry). Either way the conversation is live and the ball is with us.
  if (lastInbound !== null && (lastOutbound === null || lastInbound >= lastOutbound)) {
    return { ...base, engagement_state: "in_conversation" };
  }

  // We spoke last. A due follow-up outranks stalling: it is an instruction
  // somebody left, and acting on it is what clears it.
  if (scheduled !== null && scheduled <= now) {
    return { ...base, engagement_state: "follow_up_due" };
  }

  const quietFor = lastOutbound === null ? 0 : now - lastOutbound;
  if (
    attempts >= policy.maxAttempts &&
    quietFor >= policy.stallAfterDays * MS_PER_DAY
  ) {
    return { ...base, engagement_state: "stalled" };
  }

  return { ...base, engagement_state: "awaiting_reply" };
}

/** ISO timestamp `days` from `from`. Used when scheduling a default follow-up. */
export function followUpDate(
  from: Date | string | number,
  days: number
): string {
  const base =
    from instanceof Date
      ? from.getTime()
      : typeof from === "number"
        ? from
        : new Date(from).getTime();
  return new Date(base + days * MS_PER_DAY).toISOString();
}

/**
 * One-line timeline summary for an activity that did not supply its own.
 * Kept here so the API, the flows and the UI all render a row the same way.
 */
export function summarizeActivity(a: EngagementActivity & {
  subject?: string | null
  recipient?: string | null
}): string {
  const channel = a.channel ? String(a.channel).replace(/_/g, " ") : null;
  const verb =
    a.direction === "inbound"
      ? "Received"
      : a.direction === "outbound"
        ? "Sent"
        : "Logged";
  const what = a.subject || a.kind || a.activity_type || "activity";
  return channel ? `${verb} ${channel}: ${what}` : `${verb}: ${what}`;
}
