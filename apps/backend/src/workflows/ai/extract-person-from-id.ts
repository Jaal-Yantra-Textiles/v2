import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { generateObject } from "ai"
import { z } from "zod"

import {
  resolveRoleVisionModel,
  resolveRoleVisionModels,
} from "../../mastra/services/ai-platforms"
import {
  describeVisionAttempts,
  ID_CARD_SYSTEM_PROMPT,
  isBlindRead,
  normaliseIdCardExtraction,
  personCreateInputFromDraft,
  type IdNumberPolicy,
  type PersonDraft,
} from "../../lib/people/id-card"
import { isKnownTextOnly } from "../../api/admin/assistant/vision/guards"
import { PERSON_MODULE } from "../../modules/person"

/**
 * Read a photographed identity document and, optionally, create the person.
 *
 * ## Preview first, always
 *
 * `persist` defaults to false and the route requires `confirm` on top of it.
 * An extraction is a machine's reading of a photograph of a legal document
 * belonging to a real person; the operator looks at the draft and its warnings
 * before a row exists. This mirrors `extract_inventory_from_image` (#769),
 * which established the pattern for exactly this reason.
 *
 * ## The provider ladder
 *
 * Vision models are configured per role as External Platforms. This asks for
 * `ai_id_extraction` first — a dedicated knob, so an operator can point a
 * stronger OCR model at identity documents without disturbing inventory —
 * and falls back to the `ai_image_extraction` ladder, which already has
 * vision platforms configured, then to the free OpenRouter vision model.
 *
 * 🔑 It walks the ladder on FAILURE, not on a poor reading. A model that
 * returns a confident wrong answer is not something a retry fixes, and
 * re-reading the same card until some model likes it is how you launder a
 * misread into a fact. Only transport/parse errors advance the ladder.
 */
export type ExtractPersonFromIdInput = {
  image_url: string
  notes?: string | null
  id_number_policy?: IdNumberPolicy
  persist?: boolean
  /** Link the created person to this partner. Admin-side; the partner route fills it from auth. */
  partner_id?: string | null
  /** Person-type ids to attach on create. */
  person_type_ids?: string[] | null
}

export type ExtractPersonFromIdResult = {
  draft: PersonDraft
  person: any | null
  persisted: boolean
  model: { role: string; provider?: string; model?: string; source?: string } | null
  /** Why nothing was created, when nothing was. Never silence. */
  not_persisted_reason: string | null
}

/**
 * The shape asked of the model. Deliberately permissive — `.nullable()`
 * everywhere — because a model forced to satisfy a required field will invent
 * one, and an invented surname on an identity record is worse than a gap.
 */
const idCardSchema = z.object({
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  gender: z.string().nullable(),
  id_type: z.string().nullable(),
  id_number: z.string().nullable(),
  address: z
    .object({
      street: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      postal_code: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  confidence: z.number(),
})

/**
 * Reasoning vision models spend their budget thinking before they answer; on
 * Cloudflare's OpenAI-compatible endpoint that thinking goes to
 * `reasoning_content` while the answer stays empty. Capping this low is how you
 * manufacture a convincing "the model returned nothing" — same figure the
 * `read_image` route settled on against a live probe.
 */
const MAX_OUTPUT_TOKENS = 4000

/**
 * How long ONE model gets, and how long the whole ladder gets.
 *
 * 🔴 Both exist because neither did, and prod showed what that costs
 * (2026-09-05, `/copilot/jyt-prod-medusa-server`):
 *
 *   00:01:55  rung failed (cloudflare/@cf/meta/llama-3.2-11b-vision-instruct): Bad Request
 *   00:02:55  responded 504 after 60,088 ms          ← the caller gave up here
 *   00:14:35  rung failed (custom/meta/llama-3.2-90b-vision-instruct):
 *             Failed after 3 attempts. Last error: Cannot connect to API: Headers Timeout Error
 *
 * The second rung retried for **eleven and a half minutes**, eleven of them
 * after the request it belonged to had already died at Cloudflare's edge. The
 * operator got an opaque 504, the assistant guessed at a cause, and told them
 * their photograph was blurry — for a read that never happened.
 *
 * A ladder behind a 100s edge limit has to fit inside it, and has to come back
 * with the reason rather than the gateway's guess.
 */
const RUNG_TIMEOUT_MS = 25_000
const LADDER_BUDGET_MS = 70_000

const readIdCardStep = createStep(
  "read-id-card-with-vision",
  async (input: ExtractPersonFromIdInput, { container }) => {
    let logger: any
    try {
      logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    } catch {
      /* optional */
    }

    // Dedicated role first, then the role that already has vision platforms
    // configured, then the free fallback. Deduped by model id so a platform
    // tagged for both roles is not tried twice.
    const ladder: any[] = []
    try {
      ladder.push(...(await resolveRoleVisionModels(container, "ai_id_extraction")))
    } catch {
      /* no platform for the dedicated role — expected until one is tagged */
    }
    try {
      ladder.push(
        ...(await resolveRoleVisionModels(container, "ai_image_extraction"))
      )
    } catch {
      /* fall through to the free model */
    }
    ladder.push(await resolveRoleVisionModel(container, "ai_image_extraction"))

    const seen = new Set<string>()
    const rungs = ladder.filter((r) => {
      const key = `${r.platformId ?? r.providerType}:${r.modelId ?? "default"}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const failures: string[] = []
    /** Rungs that answered 200 and read nothing at all — see `isBlindRead`. */
    const readEmpty: string[] = []
    /** Rungs never asked, because they cannot see an image. */
    const skippedTextOnly: string[] = []
    /** The last empty answer, kept so a preview still has something to show. */
    let lastEmpty: any = null
    let lastEmptyRung: any = null

    const ladderStarted = Date.now()

    for (const rung of rungs) {
      const label = `${rung.providerType}/${rung.modelId ?? "default"}`

      /**
       * Stop before starting a rung that cannot finish in time. Burning the
       * remaining seconds on a model we already know we cannot wait for turns
       * a reportable failure into a gateway timeout.
       */
      const remaining = LADDER_BUDGET_MS - (Date.now() - ladderStarted)
      if (remaining <= 2_000) {
        failures.push(`${label}: not attempted — the time budget was already spent`)
        logger?.warn?.(
          `[id-extraction] budget exhausted before ${label}; stopping the ladder`
        )
        break
      }

      /**
       * 🔴 Refused up front, because there is no error to catch.
       *
       * Cloudflare returns HTTP 200 for a text-only model with an image
       * attached, having silently dropped the image — the model then answers
       * from nothing, confidently. `read_image` learned this from a live prod
       * probe and has refused these models ever since; this path never adopted
       * the guard, so a blind rung counted as a successful read and the
       * operator was told their photograph was unreadable.
       */
      if (isKnownTextOnly(rung.modelId)) {
        skippedTextOnly.push(label)
        logger?.warn?.(
          `[id-extraction] skipping ${label}: known text-only, it would drop the image and answer anyway`
        )
        continue
      }

      const started = Date.now()
      try {
        const result: any = await generateObject({
          model: rung.model as any,
          /**
           * Reasoning vision models emit their working first and leave the
           * answer empty if the budget runs out — a successful-looking response
           * containing nothing. Same cap as `read_image`.
           */
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          /**
           * 🔴 The provider's own retries are INSIDE this call. Without a
           * signal, "3 attempts" against an unreachable endpoint ran for 11
           * minutes — see the constants above.
           */
          abortSignal: AbortSignal.timeout(Math.min(RUNG_TIMEOUT_MS, remaining)),
          schema: idCardSchema,
          messages: [
            { role: "system", content: ID_CARD_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "image", image: input.image_url },
                {
                  type: "text",
                  text: input.notes?.trim()
                    ? `Operator context: ${input.notes.trim()}`
                    : "Read this identity document.",
                },
              ],
            },
          ],
        })

        /**
         * 🔑 An answer with EVERY field empty is not a reading, it is a rung
         * that saw nothing — so the ladder carries on instead of stopping at
         * it. Before this, the first such answer was returned as a successful
         * read and the operator was told the ID photo was blurry.
         */
        if (isBlindRead(result.object)) {
          readEmpty.push(label)
          lastEmpty = result.object
          lastEmptyRung = rung
          logger?.warn?.(
            `[id-extraction] ${label} returned no fields in ${
              Date.now() - started
            }ms — trying the next model`
          )
          continue
        }

        logger?.info?.(
          `[id-extraction] read ok via ${label} in ${Date.now() - started}ms`
        )

        return new StepResponse({
          raw: result.object,
          model: {
            role: "ai_id_extraction",
            provider: rung.providerType,
            model: rung.modelId,
            source: rung.source,
          },
          diagnostics: null,
        })
      } catch (e: any) {
        // Transport/parse failure only — see the ladder note above.
        failures.push(`${label}: ${e?.message ?? e}`)
        logger?.warn?.(`[id-extraction] rung failed (${label}): ${e?.message ?? e}`)
      }
    }

    /**
     * Every model answered, none of them saw anything.
     *
     * REPORTED, not thrown — the preview's whole job is to show the operator
     * what the machine made of the photograph, and a 500 shows them nothing.
     * The diagnostics travel with it so the message can name what was tried
     * instead of blaming the picture.
     */
    if (lastEmpty) {
      const diagnostics = describeVisionAttempts({
        read_empty: readEmpty,
        skipped_text_only: skippedTextOnly,
      })
      logger?.warn?.(`[id-extraction] ${diagnostics}`)

      return new StepResponse({
        raw: lastEmpty,
        model: {
          role: "ai_id_extraction",
          provider: lastEmptyRung?.providerType,
          model: lastEmptyRung?.modelId,
          source: lastEmptyRung?.source,
        },
        diagnostics,
      })
    }

    /**
     * Nothing answered at all. This includes the case where every configured
     * model was skipped as text-only — which is a CONFIGURATION problem and
     * says so, rather than surfacing as "the document could not be read".
     */
    if (!failures.length && skippedTextOnly.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `No vision-capable model is configured for ai_id_extraction or ai_image_extraction. ` +
          `Every candidate is text-only and would ignore the image: ${skippedTextOnly.join(", ")}. ` +
          `Point one of those platforms at a vision model in Settings → External Platforms.`
      )
    }

    /**
     * 🔑 The failures are NAMED. This message is what the operator is shown
     * when nothing worked, and the alternative is what prod actually did: a
     * bare 504 that the assistant filled in with a guess about the
     * photograph's lighting.
     */
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `No vision model could read this document — this is a model or credentials problem, not necessarily a problem with the photo. ` +
        `Tried ${rungs.length - skippedTextOnly.length}${
          skippedTextOnly.length
            ? ` (skipped as text-only: ${skippedTextOnly.join(", ")})`
            : ""
        }: ${failures.join(" | ")}. ` +
        `Check the ai_id_extraction / ai_image_extraction platforms in Settings → External Platforms.`
    )
  }
)

const createPersonStep = createStep(
  "create-person-from-id-draft",
  async (
    input: { draft: PersonDraft; source_image_url: string; person_type_ids?: string[] | null },
    { container }
  ) => {
    const personService: any = container.resolve(PERSON_MODULE)

    const payload = personCreateInputFromDraft(input.draft, {
      source_image_url: input.source_image_url,
    })

    const created = await personService.createPeople(payload)
    const person = Array.isArray(created) ? created[0] : created

    // The address is a separate row, and is not worth failing the person over:
    // a person with no address is recoverable, a half-created person is not.
    if (input.draft.address && person?.id) {
      const a = input.draft.address
      try {
        // 🔴 `createAddresses`, not `createPersonAddresses`. The generated name
        // follows the MODEL name (`person_address` → Addresses), and the wrong
        // one throws straight into the catch below — an address that silently
        // never appears, on a path whose whole job is to save typing.
        await personService.createAddresses({
          person_id: person.id,
          street: a.street ?? "",
          city: a.city ?? "",
          state: a.state ?? "",
          postal_code: a.postal_code ?? "",
          country: a.country ?? "",
        })
      } catch {
        /* address is best-effort; the person still stands */
      }
    }

    return new StepResponse({ person }, { person_id: person?.id })
  },
  async (undo, { container }) => {
    if (!undo?.person_id) return
    const personService: any = container.resolve(PERSON_MODULE)
    await personService.deletePeople(undo.person_id).catch(() => {})
  }
)

/**
 * PURE decision step: what the reading means, and whether to create.
 *
 * Both refusals are REPORTED, never thrown — a preview that 500s tells the
 * operator nothing about what the model saw, which is the whole point of
 * previewing.
 */
const normaliseDraftStep = createStep(
  "normalise-id-card-draft",
  async (i: {
    raw: any
    policy?: IdNumberPolicy
    persist?: boolean
    diagnostics?: string | null
  }) => {
    const draft = normaliseIdCardExtraction(i.raw, {
      id_number_policy: i.policy ?? "mask",
    })

    /**
     * 🔴 What was TRIED goes in front of the operator, not just what was found.
     *
     * "No name could be read from the image" reads as a verdict on the
     * photograph. When the cause is a model that never saw it, that sentence
     * sends someone to retake a picture that was never the problem — which is
     * exactly what happened.
     */
    if (i.diagnostics) {
      draft.warnings.unshift(i.diagnostics)
    }

    const reason = !i.persist
      ? "persist was not requested — this is a preview."
      : !draft.creatable
      ? "the document could not be read well enough to create a person; see warnings."
      : null

    return new StepResponse({
      draft,
      should_create: Boolean(i.persist) && draft.creatable,
      reason,
    })
  }
)

export const extractPersonFromIdWorkflow = createWorkflow(
  { name: "extract-person-from-id", store: true },
  (input: ExtractPersonFromIdInput) => {
    const read = readIdCardStep(input)

    const decided = normaliseDraftStep({
      raw: read.raw,
      policy: input.id_number_policy,
      persist: input.persist,
      diagnostics: read.diagnostics,
    })

    const created = when(decided, (d: any) => d.should_create).then(() =>
      createPersonStep({
        draft: decided.draft,
        source_image_url: input.image_url,
        person_type_ids: input.person_type_ids,
      })
    )

    return new WorkflowResponse(
      transform({ decided, created, read }, (d: any) => ({
        draft: d.decided.draft,
        person: d.created?.person ?? null,
        persisted: Boolean(d.created?.person),
        not_persisted_reason: d.decided.reason,
        model: d.read.model,
      }))
    )
  }
)

export default extractPersonFromIdWorkflow
