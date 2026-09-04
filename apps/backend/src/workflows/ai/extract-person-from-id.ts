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
  ID_CARD_SYSTEM_PROMPT,
  normaliseIdCardExtraction,
  personCreateInputFromDraft,
  type IdNumberPolicy,
  type PersonDraft,
} from "../../lib/people/id-card"
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

    for (const rung of rungs) {
      const started = Date.now()
      try {
        const result: any = await generateObject({
          model: rung.model as any,
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

        logger?.info?.(
          `[id-extraction] read ok via ${rung.providerType}/${
            rung.modelId ?? "default"
          } in ${Date.now() - started}ms`
        )

        return new StepResponse({
          raw: result.object,
          model: {
            role: "ai_id_extraction",
            provider: rung.providerType,
            model: rung.modelId,
            source: rung.source,
          },
        })
      } catch (e: any) {
        // Transport/parse failure only — see the ladder note above.
        failures.push(`${rung.providerType}/${rung.modelId ?? "default"}: ${e?.message ?? e}`)
        logger?.warn?.(
          `[id-extraction] rung failed (${rung.providerType}/${rung.modelId ?? "default"}): ${
            e?.message ?? e
          }`
        )
      }
    }

    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Could not read the document with any configured vision provider. Tried ${rungs.length}: ${failures.join(
        " | "
      )}`
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
  async (i: { raw: any; policy?: IdNumberPolicy; persist?: boolean }) => {
    const draft = normaliseIdCardExtraction(i.raw, {
      id_number_policy: i.policy ?? "mask",
    })

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
