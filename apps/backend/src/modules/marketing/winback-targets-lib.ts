/**
 * winback-targets-lib.ts — pure winback target selection (#659, report §12.5).
 *
 * Reads NOTHING: callers pass in churn-risk scores (from ad_planning
 * `CustomerScore`, score_type="churn_risk"), optional CLV scores, resolved
 * Person contacts, and the set of already-targeted emails. This lib does the
 * threshold + optional-CLV + dedup + idempotency + cap selection and is fully
 * unit-testable without a DB.
 *
 * Honesty rules (report §6 + daemon brief): a churn score whose person has no
 * Person row or no email is RECORDED as skipped (reason), never dropped silently
 * and never a crash — `person_id` only exists for buyers WITH a Person (#664).
 */

export type ChurnScoreRow = {
  person_id: string
  /** churn risk 0..100, higher = more at risk */
  score_value: number
}

export type PersonContact = {
  id: string
  email?: string | null
  name?: string | null
}

export type WinbackSelectOptions = {
  /** minimum churn_risk to qualify (inclusive). Default 70. */
  minChurnRisk?: number
  /** optional CLV floor — when set, a person needs clv >= this to qualify. */
  minClv?: number | null
  /** max targets to return after sorting highest-risk first. Default 50. */
  cap?: number
}

export type WinbackTarget = {
  person_id: string
  email: string
  name: string | null
  churn_risk: number
  clv: number | null
}

export type WinbackSkip = {
  person_id: string
  reason:
    | "below_threshold"
    | "no_person"
    | "no_email"
    | "clv_below"
    | "already_targeted"
  churn_risk: number
}

export type WinbackSelection = {
  targets: WinbackTarget[]
  skipped: WinbackSkip[]
  stats: {
    scanned: number
    qualified: number
    targeted: number
    skipped: number
    capped: number
  }
}

const DEFAULT_MIN_CHURN = 70
const DEFAULT_CAP = 50

function normEmail(email: string | null | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

/**
 * Pure: choose winback targets from churn scores.
 *
 * @param churnScores  churn_risk rows (any order)
 * @param contactById  person_id → contact (email/name); missing = no Person row
 * @param clvById      person_id → CLV score_value (optional)
 * @param alreadyTargetedEmails  lowercased emails already in campaign="winback"
 */
export function selectWinbackTargets(
  churnScores: ChurnScoreRow[],
  contactById: Map<string, PersonContact>,
  clvById: Map<string, number> | undefined,
  alreadyTargeted: Set<string>,
  opts: WinbackSelectOptions = {}
): WinbackSelection {
  const minChurn = Number.isFinite(opts.minChurnRisk as number)
    ? (opts.minChurnRisk as number)
    : DEFAULT_MIN_CHURN
  const minClv =
    opts.minClv != null && Number.isFinite(opts.minClv) ? opts.minClv : null
  const cap = Number.isFinite(opts.cap as number) && (opts.cap as number) > 0
    ? Math.floor(opts.cap as number)
    : DEFAULT_CAP

  const skipped: WinbackSkip[] = []
  const eligible: WinbackTarget[] = []
  const seen = new Set<string>()

  for (const row of churnScores ?? []) {
    const pid = row?.person_id
    if (!pid || seen.has(pid)) continue // dedup per person_id
    seen.add(pid)

    const churn = Number(row.score_value)
    if (!Number.isFinite(churn) || churn < minChurn) {
      skipped.push({ person_id: pid, reason: "below_threshold", churn_risk: churn })
      continue
    }

    const contact = contactById.get(pid)
    if (!contact) {
      skipped.push({ person_id: pid, reason: "no_person", churn_risk: churn })
      continue
    }
    const email = normEmail(contact.email)
    if (!email) {
      skipped.push({ person_id: pid, reason: "no_email", churn_risk: churn })
      continue
    }

    const clv = clvById?.has(pid) ? Number(clvById.get(pid)) : null
    if (minClv != null && (clv == null || clv < minClv)) {
      skipped.push({ person_id: pid, reason: "clv_below", churn_risk: churn })
      continue
    }

    if (alreadyTargeted.has(email)) {
      skipped.push({ person_id: pid, reason: "already_targeted", churn_risk: churn })
      continue
    }

    eligible.push({
      person_id: pid,
      email,
      name: contact.name ?? null,
      churn_risk: churn,
      clv: clv != null && Number.isFinite(clv) ? clv : null,
    })
  }

  // highest churn risk first; cap.
  eligible.sort((a, b) => b.churn_risk - a.churn_risk)
  const qualified = eligible.length
  const targets = eligible.slice(0, cap)

  return {
    targets,
    skipped,
    stats: {
      scanned: (churnScores ?? []).length,
      qualified,
      targeted: targets.length,
      skipped: skipped.length,
      capped: Math.max(0, qualified - targets.length),
    },
  }
}
