import {
  Badge,
  Button,
  Checkbox,
  Heading,
  Input,
  Label,
  ProgressTabs,
  RadioGroup,
  Text,
  Textarea,
  clx,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"
import { FileUpload, type FileType } from "../../../components/common/file-upload"
import {
  IncomingAnswer,
  InquiryQuestion,
  InquiryVerdict,
  useCreatePartnerCapability,
  usePartnerCapabilities,
  usePartnerInquiry,
  useSavePartnerInquiryAnswers,
  useSubmitPartnerInquiry,
  useUploadCapabilityMedia,
} from "../../../hooks/api/partner-inquiries"

/**
 * The wizard a partner actually fills in (#1531 slice 2).
 *
 * ## Why it is stepped and not one long form
 *
 * The steps ARE the design's spec categories — Materials, Measurements,
 * Construction — because the spec is already the questionnaire. That is the
 * whole idea behind #1531: a designer wrote what this thing is made of, so
 * nobody has to invent a form for it.
 *
 * One step per screen because this is answered on a phone, standing at a loom.
 * A twenty-question scroll gets abandoned halfway; a three-question screen gets
 * finished.
 *
 * ## 🔑 Every step is saved as it is left
 *
 * Not on submit. A partner at a loom loses their connection, and an answer
 * that only existed in a browser tab is an answer nobody ever gets. Saving is
 * deliberately NOT answering, though — the response carries no verdict until
 * the last screen, so a half-filled wizard still reads as silence in the
 * comparison rather than as a reply.
 *
 * ## What is deliberately absent
 *
 * No other partner appears anywhere on this page. Several are asked the same
 * questions and their lead times and prices are the most commercially
 * sensitive thing either of them tells us; the server refuses to serve them,
 * and this never asks.
 */

const VERDICTS: Array<{
  value: InquiryVerdict
  label: string
  hint: string
}> = [
  {
    value: "can_make",
    label: "Yes, we can make this",
    hint: "As specified, with what we have.",
  },
  {
    value: "with_changes",
    label: "Yes, with changes",
    hint: "Tell us what would have to change — this is the most useful answer.",
  },
  {
    value: "cannot_make",
    label: "No, not this one",
    hint: "Saying so costs you nothing and saves us both a week.",
  },
]

/** The value a question starts from, so a half-finished wizard resumes. */
const initialValues = (
  questions: InquiryQuestion[],
  answers: Array<{
    question_id: string
    value?: unknown
    note?: string | null
    capability_sample_ids?: string[] | null
  }>
) => {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]))
  const values: Record<string, unknown> = {}
  const notes: Record<string, string> = {}
  const samples: Record<string, string[]> = {}
  for (const question of questions) {
    const existing = byQuestion.get(question.id)
    values[question.id] = existing?.value ?? null
    notes[question.id] = existing?.note ?? ""
    samples[question.id] = existing?.capability_sample_ids ?? []
  }
  return { values, notes, samples }
}

export const InquiryDetail = () => {
  const { id } = useParams()
  const inquiryId = String(id)

  const { inquiry, design, questions, response, answers, isLoading } =
    usePartnerInquiry(inquiryId)

  const saveAnswers = useSavePartnerInquiryAnswers(inquiryId)
  const submit = useSubmitPartnerInquiry(inquiryId)

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  /** question_id → capability_sample ids attached to that answer (#1543). */
  const [samples, setSamples] = useState<Record<string, string[]>>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [verdict, setVerdict] = useState<InquiryVerdict | null>(null)
  const [leadTime, setLeadTime] = useState("")
  const [price, setPrice] = useState("")
  const [summaryNote, setSummaryNote] = useState("")

  const closed = inquiry?.status === "closed"

  /**
   * 🔴 Seeded from the server ONCE, and never again for this inquiry.
   *
   * The obvious `[questions, answers]` dependency looks harmless and quietly
   * eats what the partner has typed: every autosave invalidates the detail
   * query, the refetch hands back new array identities, the effect re-runs and
   * overwrites local state with the server's copy — including any field edited
   * in the seconds between the save firing and the refetch landing.
   *
   * That failure is invisible. Nothing errors; a sentence the partner wrote
   * simply is not there any more, and they have no way to tell whether it was
   * ever sent. The server's answers are already what this page wrote, so there
   * is nothing to re-read — the only moment seeding is needed is the first
   * load, where it resumes a half-finished wizard.
   */
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!questions?.length) return
    if (seededFor.current === inquiryId) return
    seededFor.current = inquiryId
    const seeded = initialValues(questions, answers ?? [])
    setValues(seeded.values)
    setNotes(seeded.notes)
    setSamples(seeded.samples)
  }, [questions, answers, inquiryId])

  // Same reasoning as the seed above: the summary fields are read once, so a
  // refetch cannot overwrite a price the partner is mid-way through typing.
  const seededSummaryFor = useRef<string | null>(null)
  useEffect(() => {
    if (!response) return
    if (seededSummaryFor.current === inquiryId) return
    seededSummaryFor.current = inquiryId
    setVerdict(response.verdict ?? null)
    setLeadTime(
      response.lead_time_days === null || response.lead_time_days === undefined
        ? ""
        : String(response.lead_time_days)
    )
    setPrice(
      response.indicative_price === null ||
        response.indicative_price === undefined
        ? ""
        : String(response.indicative_price)
    )
    setSummaryNote(response.notes ?? "")
  }, [response, inquiryId])

  /**
   * The steps, in the order the questions were generated.
   *
   * 🔴 Grouped from the persisted `step` on each question, never re-derived
   * from the design's current spec. The spec moves while sourcing runs — the
   * inquiry records `spec_version` for exactly that reason — and a wizard that
   * silently reworded itself between being sent and being answered would make
   * every answer unreadable.
   */
  const steps = useMemo(() => {
    const ordered = [...(questions ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    )
    const grouped: Array<{ step: string; questions: InquiryQuestion[] }> = []
    for (const question of ordered) {
      const last = grouped[grouped.length - 1]
      if (last && last.step === question.step) {
        last.questions.push(question)
      } else {
        grouped.push({ step: question.step, questions: [question] })
      }
    }
    return grouped
  }, [questions])

  const isSummary = stepIndex >= steps.length
  const current = steps[stepIndex]

  const answersFor = (questionsToSave: InquiryQuestion[]): IncomingAnswer[] =>
    questionsToSave
      .map((question) => ({
        question_id: question.id,
        value: values[question.id] ?? null,
        note: notes[question.id]?.trim() ? notes[question.id].trim() : null,
        capability_sample_ids: samples[question.id] ?? [],
      }))
      // An untouched question is left alone rather than written as an explicit
      // null: "not answered yet" and "answered with nothing" are different
      // things, and only one of them is worth showing in the comparison.
      //
      // 🔴 A photo question has NO `value` and NO `note` — the photograph IS
      // the answer. Without the sample clause here, attaching a picture and
      // pressing "Save and continue" would filter the answer out and save
      // nothing, silently, on the one kind of question that cannot be retyped.
      .filter(
        (a) =>
          a.value !== null ||
          a.note !== null ||
          (a.capability_sample_ids?.length ?? 0) > 0
      )

  const goToStep = async (next: number) => {
    if (closed) {
      setStepIndex(next)
      return
    }
    const toSave = current ? answersFor(current.questions) : []
    if (toSave.length) {
      try {
        await saveAnswers.mutateAsync({ answers: toSave })
      } catch (e: any) {
        // 🔑 Do NOT advance on a failed save. Moving on would show the next
        // step as though the last one had been recorded, and the partner would
        // finish a wizard that kept nothing.
        toast.error(e?.message ?? "That step could not be saved.")
        return
      }
    }
    setStepIndex(next)
  }

  const onSubmit = async () => {
    if (!verdict) {
      toast.error("Tell us whether you can make this — that is the answer we need.")
      return
    }
    try {
      await submit.mutateAsync({
        verdict,
        lead_time_days: leadTime.trim() ? Number(leadTime) : null,
        indicative_price: price.trim() ? Number(price) : null,
        notes: summaryNote.trim() || null,
        // Whatever is on screen goes with the verdict, so "save and submit" is
        // one round trip and cannot half-land.
        answers: steps.flatMap((s) => answersFor(s.questions)),
      })
      toast.success("Thank you — we have your answer.")
    } catch (e: any) {
      toast.error(e?.message ?? "That could not be submitted.")
    }
  }

  if (isLoading) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header>
          <RouteFocusModal.Title>Loading…</RouteFocusModal.Title>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="overflow-y-auto px-6 py-6">
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <span className="sr-only">{inquiry?.title ?? "Inquiry"}</span>
        </RouteFocusModal.Title>
      </RouteFocusModal.Header>

      {/* 🔴 overflow-y-auto is NOT optional on a FocusModal body. Without it
          the body does not scroll, and on a phone — which is the whole point
          of this wizard — the questions below the fold are unreachable and the
          footer buttons sit off-screen. ~98 partner-ui modals still lack it. */}
      <RouteFocusModal.Body className="flex flex-col divide-y overflow-y-auto p-0">
        <div className="flex items-start gap-4 px-6 py-4">
          {design?.thumbnail_url && (
            <img
              src={design.thumbnail_url}
              alt=""
              className="size-16 shrink-0 rounded-md object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <Heading level="h2">{inquiry?.title}</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {design?.name ?? inquiry?.design_id}
            </Text>
            {inquiry?.brief_note && (
              <Text size="small" className="mt-2">
                {inquiry.brief_note}
              </Text>
            )}
          </div>
          {response?.submitted_at && (
            <Badge size="2xsmall" color="green">
              Answered
            </Badge>
          )}
        </div>

        {/* The moodboard (#1543).
            🔴 This was returned by the route as bare ids from the day it was
            written, and nothing rendered them — so a designer attached the
            references that explain the ask, and the partner was asked "can you
            make this?" while being shown nothing. Nothing errored: the field
            was populated and the array was right there in the response. */}
        {!!inquiry?.reference_media?.length && (
          <div className="flex flex-col gap-2 px-6 py-4">
            <Text size="small" weight="plus">
              What we are after
            </Text>
            <div className="flex flex-wrap gap-2">
              {inquiry.reference_media.map((m) => (
                <a
                  key={m.id}
                  href={m.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={m.name ?? "Reference"}
                >
                  <img
                    src={m.url}
                    alt={m.name ?? ""}
                    className="size-24 rounded-md border object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {closed && (
          <div className="bg-ui-bg-subtle px-6 py-3">
            <Text size="small" className="text-ui-fg-subtle">
              This inquiry has been closed, so it can no longer be answered. Your
              answers are kept below.
            </Text>
          </div>
        )}

        <div className="px-6 py-4">
          <ProgressTabs value={String(Math.min(stepIndex, steps.length))}>
            <ProgressTabs.List>
              {steps.map((step, index) => (
                <ProgressTabs.Trigger
                  key={step.step}
                  value={String(index)}
                  onClick={() => goToStep(index)}
                >
                  {step.step}
                </ProgressTabs.Trigger>
              ))}
              <ProgressTabs.Trigger
                value={String(steps.length)}
                onClick={() => goToStep(steps.length)}
              >
                Your answer
              </ProgressTabs.Trigger>
            </ProgressTabs.List>
          </ProgressTabs>
        </div>

        <div className="flex flex-col gap-6 px-6 py-6">
          {!isSummary &&
            current?.questions.map((question) => (
              <QuestionField
                key={question.id}
                question={question}
                value={values[question.id]}
                note={notes[question.id] ?? ""}
                sampleIds={samples[question.id] ?? []}
                disabled={closed}
                onValue={(v) =>
                  setValues((prev) => ({ ...prev, [question.id]: v }))
                }
                onNote={(v) =>
                  setNotes((prev) => ({ ...prev, [question.id]: v }))
                }
                onSampleIds={(ids) =>
                  setSamples((prev) => ({ ...prev, [question.id]: ids }))
                }
              />
            ))}

          {isSummary && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <Label>Can you make this?</Label>
                <RadioGroup
                  value={verdict ?? ""}
                  onValueChange={(v) => setVerdict(v as InquiryVerdict)}
                >
                  {VERDICTS.map((option) => (
                    <div key={option.value} className="flex items-start gap-3">
                      <RadioGroup.Item
                        value={option.value}
                        id={`verdict-${option.value}`}
                        disabled={closed}
                      />
                      <div>
                        <Label htmlFor={`verdict-${option.value}`}>
                          {option.label}
                        </Label>
                        <Text size="small" className="text-ui-fg-subtle">
                          {option.hint}
                        </Text>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="lead-time">Lead time (days)</Label>
                  <Input
                    id="lead-time"
                    type="number"
                    min={1}
                    value={leadTime}
                    disabled={closed}
                    onChange={(e) => setLeadTime(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="price">Indicative price per piece</Label>
                  <Input
                    id="price"
                    type="number"
                    min={0}
                    value={price}
                    disabled={closed}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <Text size="small" className="text-ui-fg-subtle">
                    A rough figure is fine. It is not a quote and nothing is
                    ordered from it.
                  </Text>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="summary-note">Anything else we should know</Label>
                <Textarea
                  id="summary-note"
                  rows={3}
                  value={summaryNote}
                  disabled={closed}
                  onChange={(e) => setSummaryNote(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex w-full items-center justify-between">
          <Button
            size="small"
            variant="secondary"
            disabled={stepIndex === 0}
            onClick={() => goToStep(Math.max(0, stepIndex - 1))}
          >
            Back
          </Button>

          {!isSummary ? (
            <Button
              size="small"
              isLoading={saveAnswers.isPending}
              onClick={() => goToStep(stepIndex + 1)}
            >
              Save and continue
            </Button>
          ) : (
            <Button
              size="small"
              disabled={closed}
              isLoading={submit.isPending}
              onClick={onSubmit}
            >
              {response?.submitted_at ? "Update my answer" : "Send my answer"}
            </Button>
          )}
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  )
}

/**
 * One question, rendered by its kind.
 *
 * 🔑 The note box is on EVERY kind, not only on "no". The useful part of a no
 * is almost always the sentence after it — "not in that GSM, but I can do 90"
 * is how a design actually develops, and a yes/no with nowhere to put that
 * throws away the only answer worth having.
 */
const QuestionField = ({
  question,
  value,
  note,
  sampleIds,
  disabled,
  onValue,
  onNote,
  onSampleIds,
}: {
  question: InquiryQuestion
  value: unknown
  note: string
  sampleIds: string[]
  disabled?: boolean
  onValue: (value: unknown) => void
  onNote: (value: string) => void
  onSampleIds: (ids: string[]) => void
}) => {
  const selected = Array.isArray(value) ? (value as string[]) : []

  return (
    <div className="flex flex-col gap-3">
      <Label>{question.prompt}</Label>

      {question.kind === "yes_no" && (
        <RadioGroup
          value={value === true ? "yes" : value === false ? "no" : ""}
          onValueChange={(v) => onValue(v === "yes")}
        >
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <RadioGroup.Item
                value="yes"
                id={`${question.id}-yes`}
                disabled={disabled}
              />
              <Label htmlFor={`${question.id}-yes`}>Yes</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroup.Item
                value="no"
                id={`${question.id}-no`}
                disabled={disabled}
              />
              <Label htmlFor={`${question.id}-no`}>No</Label>
            </div>
          </div>
        </RadioGroup>
      )}

      {question.kind === "number" && (
        <Input
          type="number"
          disabled={disabled}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) =>
            onValue(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      )}

      {question.kind === "text" && (
        <Textarea
          rows={2}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onValue(e.target.value || null)}
        />
      )}

      {question.kind === "colour_select" && (
        <div className="flex flex-wrap gap-3">
          {(question.options ?? []).map((option) => {
            const key = option.value
            const checked = selected.includes(key)
            return (
              <label
                key={key}
                className={clx(
                  "flex items-center gap-2 rounded-md border px-3 py-2",
                  checked ? "border-ui-border-interactive" : "border-ui-border-base"
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(next) =>
                    onValue(
                      next
                        ? [...selected, key]
                        : selected.filter((v) => v !== key)
                    )
                  }
                />
                {option.hex && (
                  <span
                    aria-hidden
                    className="size-4 rounded-full border"
                    style={{ backgroundColor: option.hex }}
                  />
                )}
                <Text size="small">{option.value}</Text>
              </label>
            )
          })}
        </div>
      )}

      {question.kind === "photo" && (
        <PhotoAnswer
          question={question}
          sampleIds={sampleIds}
          disabled={disabled}
          onSampleIds={onSampleIds}
        />
      )}

      <Textarea
        rows={2}
        placeholder="Anything worth adding — what you'd change, what you'd need"
        disabled={disabled}
        value={note}
        onChange={(e) => onNote(e.target.value)}
      />
    </div>
  )
}

/**
 * The photograph answer (#1543).
 *
 * The wizard has always HAD a `photo` question kind, the answer model has
 * always carried `capability_sample_ids`, and the route has always validated
 * them — and this rendered a sentence apologising for itself: *"Send the photo
 * in your reply and we will attach it here."* So the one question whose answer
 * cannot be typed was the one that sent the partner back to WhatsApp, which is
 * the loop #1531 exists to close.
 *
 * ## Why two calls and not one
 *
 * Upload → create sample → attach the sample id. The middle step is not
 * ceremony: a sample is a LIBRARY entry that outlives this inquiry, which is
 * what stops the same partner being asked the same question next season. The
 * inquiry is an event; the library is what it deposits into.
 *
 * ## 🔴 The id is attached only after the sample exists
 *
 * Not optimistically. `capability_sample_ids` is validated server-side against
 * the partner's own library, so an id attached before its row existed would
 * fail the NEXT step's autosave — and it would fail there, on a different
 * screen, complaining about a question the partner had already left behind.
 */
const PhotoAnswer = ({
  question,
  sampleIds,
  disabled,
  onSampleIds,
}: {
  question: InquiryQuestion
  sampleIds: string[]
  disabled?: boolean
  onSampleIds: (ids: string[]) => void
}) => {
  const upload = useUploadCapabilityMedia()
  const createSample = useCreatePartnerCapability()

  /**
   * The partner's own library, so an attachment can be one they already have.
   * Filtered to the ids on this answer for rendering; the whole list is what
   * makes "I photographed this last month" a click rather than a re-shoot.
   */
  const { samples } = usePartnerCapabilities({ limit: 50 })
  const attached = samples.filter((s) => sampleIds.includes(s.id))

  const busy = upload.isPending || createSample.isPending

  const handleFiles = async (files: FileType[]) => {
    if (!files.length) return
    try {
      const { media } = await upload.mutateAsync(files.map((f) => f.file))
      if (!media?.length) {
        toast.error("Nothing came back from that upload. Please try again.")
        return
      }

      const { sample } = await createSample.mutateAsync({
        // The prompt is the most honest title available without asking the
        // partner to name a file — they are photographing an ANSWER to it.
        title: question.prompt,
        media_file_ids: media.map((m) => m.id),
      })

      onSampleIds([...sampleIds, sample.id])
      toast.success(
        media.length === 1 ? "Photo attached" : `${media.length} photos attached`
      )
    } catch (e: any) {
      toast.error(e?.message ?? "That photo could not be attached.")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {attached.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attached.map((sample) =>
            (sample.media ?? []).map((m) => (
              <div key={m.id} className="relative">
                <img
                  src={m.url}
                  alt={m.name ?? ""}
                  className="size-20 rounded-md border object-cover"
                />
              </div>
            ))
          )}
          {/* A sample whose photographs could not be resolved still counts as
              attached — saying so is better than an empty row that reads as
              nothing having been sent. */}
          {attached
            .filter((s) => !(s.media ?? []).length)
            .map((s) => (
              <div
                key={s.id}
                className="bg-ui-bg-subtle flex size-20 items-center justify-center rounded-md border p-2"
              >
                <Text size="xsmall" className="text-ui-fg-subtle text-center">
                  Attached
                </Text>
              </div>
            ))}
        </div>
      )}

      {!disabled && (
        <FileUpload
          label={
            attached.length ? "Add another photo" : "Take or choose a photo"
          }
          hint="A photo of the real thing tells us more than any description. JPG, PNG or HEIC."
          multiple
          formats={["image/jpeg", "image/png", "image/webp", "image/heic"]}
          onUploaded={(files, rejected) => {
            if (rejected?.length) {
              toast.error(
                `${rejected.length} file${rejected.length === 1 ? "" : "s"} could not be used — photos must be under 10MB.`
              )
            }
            void handleFiles(files)
          }}
        />
      )}

      {busy && (
        <Text size="small" className="text-ui-fg-subtle">
          Uploading — keep this open until it finishes.
        </Text>
      )}

      {disabled && !attached.length && (
        <Text size="small" className="text-ui-fg-subtle">
          No photo was attached to this answer.
        </Text>
      )}
    </div>
  )
}
