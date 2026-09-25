/**
 * Which of a partner's runs is this WhatsApp photo for? (System One)
 *
 * Before this, a photo went to a run only when the partner had EXACTLY ONE in
 * progress — a blind guess with one run (a fabric swatch landed on a shirt
 * run) and no guess at all with two (straight to "what are these for?").
 *
 * Now a pre-classifier (lib/ai/classify.ts, scope below) reads what the photo
 * SHOWS — the vision description, and the caption if any — against each run's
 * design, and may answer "none of these". Its pick is still only a GUESS: the
 * burst reply names it and asks ✅ / ❌ (whatsapp-media-ack-batch.ts).
 *
 * PURE except for nothing — the handler does the I/O.
 */
import { asChoice, choice, type Answer, type Question } from "../../lib/ai/typesafe"

/** The classifier scope a platform row must list to serve this. */
export const PHOTO_RUN_SCOPE = "whatsapp_photo_context"

/** Below this, a pick is not trusted enough to file a photo against work. */
export const PHOTO_RUN_MIN_CONFIDENCE = 0.7

export const NONE_OF_THESE = "none"

export type CandidateRun = {
  id: string
  design: string
  description?: string | null
}

/** Option keys must be plain; run ids are, but keep them stable and short. */
const keyFor = (i: number) => `run_${i + 1}`

/** PURE. The state and question for the classifier. */
export function buildPhotoRunQuestion(
  runs: CandidateRun[],
  photo: { seen: string | null; caption: string | null }
): { state: Record<string, unknown>; questions: Record<string, Question> } {
  const criteria: Record<string, { what: string; not_for?: string }> = {}
  runs.forEach((r, i) => {
    criteria[keyFor(i)] = {
      what: `a photo of work on "${r.design}"${r.description ? ` — ${String(r.description).slice(0, 160)}` : ""}`,
    }
  })
  criteria[NONE_OF_THESE] = {
    what: "anything that is not visibly one of the runs above: loose fabric or yarn offered for sale, a finished product to list, a document, a person, or a photo too unclear to tell",
    not_for: "a photo that plausibly shows work on one of the runs",
  }
  return {
    state: {
      photo_shows: photo.seen ?? "(no description available)",
      caption: photo.caption || null,
      runs_in_progress: runs.map((r, i) => ({ option: keyFor(i), design: r.design })),
    },
    questions: {
      run: choice(
        "Which of the partner's runs in progress is this photo for? Judge from what the photo shows and its caption. Choose `none` unless it plausibly shows work on that design.",
        criteria
      ),
    },
  }
}

/**
 * PURE. The run to guess, or null (ask instead). Null when the classifier
 * said none, picked nothing it was offered, or was not sure enough.
 */
export function decidePhotoRun(
  answer: Answer | undefined,
  runs: CandidateRun[],
  minConfidence: number = PHOTO_RUN_MIN_CONFIDENCE
): { runId: string | null; confidence: number | null } {
  const a = asChoice(answer)
  if (!a || a.choice === NONE_OF_THESE) return { runId: null, confidence: a?.confidence ?? null }
  const i = runs.findIndex((_, j) => keyFor(j) === a.choice)
  if (i < 0 || a.confidence < minConfidence) return { runId: null, confidence: a.confidence }
  return { runId: runs[i].id, confidence: a.confidence }
}
