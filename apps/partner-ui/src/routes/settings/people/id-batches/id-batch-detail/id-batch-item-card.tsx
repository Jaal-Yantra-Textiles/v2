import { Badge, Button, Checkbox, Input, Text } from "@medusajs/ui"
import { ExclamationCircle } from "@medusajs/icons"

import type { IdExtractionBatchItem } from "../../../../../hooks/api/id-extraction-batch"
import {
  EDITABLE_ADDRESS_FIELDS,
  isApprovable,
  type EditableAddressField,
  type ItemEdits,
} from "../../../../../lib/id-batch-approval"

const STATUS: Record<
  IdExtractionBatchItem["status"],
  { label: string; color: "grey" | "orange" | "green" | "red" | "blue" }
> = {
  pending: { label: "Not read yet", color: "grey" },
  processing: { label: "Reading", color: "blue" },
  completed: { label: "Draft ready", color: "orange" },
  failed: { label: "Failed", color: "red" },
  approved: { label: "Added to people", color: "green" },
}

const ADDRESS_LABELS: Record<EditableAddressField, string> = {
  street: "Street",
  city: "City",
  state: "State",
  postal_code: "Postal code",
  country: "Country",
}

type Props = {
  item: IdExtractionBatchItem
  edits?: ItemEdits
  selected: boolean
  onSelect: (selected: boolean) => void
  onEdit: (edits: ItemEdits) => void
  onRetry?: () => void
  isRetrying?: boolean
}

const Field = ({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (v: string) => void
}) => (
  <div>
    <Text size="xsmall" className="text-ui-fg-subtle mb-1">
      {label}
    </Text>
    <Input
      size="small"
      value={value}
      placeholder={placeholder}
      /**
       * 🔴 Locked once the person exists. Corrections are only ever applied on
       * the way from a draft to a person, so an editable box on an approved
       * card invites an edit that is silently discarded — the person is on the
       * roster and this screen is no longer the way to change them.
       */
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
)

/**
 * One photograph from a batch (#1816).
 *
 * The fields are editable in place because the reader's field ASSIGNMENT is
 * what varies, not its reading: the same card read five times in prod put the
 * whole name in `first_name` four times and split it once. The operator fixing
 * that is the point of this screen, so the correction is typed where the wrong
 * value is shown rather than in a separate dialog.
 *
 * 🔴 The reader's own warnings are rendered verbatim. They are the only signal
 * that a name was kept whole or a field dropped, and summarising them away is
 * how a review becomes a rubber stamp.
 */
export const IdBatchItemCard = ({
  item,
  edits,
  selected,
  onSelect,
  onEdit,
  onRetry,
  isRetrying,
}: Props) => {
  const status = STATUS[item.status] ?? STATUS.pending
  const draft = item.draft
  const approvable = isApprovable(item, edits)
  const locked = item.status === "approved"

  const valueOf = (field: keyof ItemEdits & string): string => {
    const typed = (edits as Record<string, unknown> | undefined)?.[field]
    if (typeof typed === "string") return typed
    const fromDraft = (draft as Record<string, unknown> | undefined)?.[field]
    return fromDraft == null ? "" : String(fromDraft)
  }

  const addressValueOf = (field: EditableAddressField): string => {
    const typed = edits?.address?.[field]
    if (typeof typed === "string") return typed
    const fromDraft = draft?.address?.[field]
    return fromDraft == null ? "" : String(fromDraft)
  }

  const setField = (field: string, v: string) =>
    onEdit({ ...(edits ?? {}), [field]: v })

  const setAddress = (field: EditableAddressField, v: string) =>
    onEdit({ ...(edits ?? {}), address: { ...(edits?.address ?? {}), [field]: v } })

  return (
    <div className="flex flex-col gap-y-4 px-6 py-5 sm:flex-row sm:gap-x-5">
      <div className="flex items-start gap-x-3">
        <Checkbox
          checked={selected}
          disabled={!approvable}
          onCheckedChange={(v) => onSelect(!!v)}
          aria-label={`Approve photograph ${item.position + 1}`}
        />
        <a
          href={item.image_url}
          target="_blank"
          rel="noreferrer"
          className="block shrink-0"
          title="Open the original photograph"
        >
          <img
            src={item.image_url}
            alt={`ID card ${item.position + 1}`}
            className="h-24 w-24 rounded-lg border border-ui-border-base object-cover bg-ui-bg-subtle"
          />
        </a>
      </div>

      <div className="flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text size="small" weight="plus">
            Photograph {item.position + 1}
          </Text>
          <Badge size="2xsmall" color={status.color}>
            {status.label}
          </Badge>
          {item.attempts > 1 && (
            <Text size="xsmall" className="text-ui-fg-muted">
              {item.attempts} attempts
            </Text>
          )}
          {item.person_id && (
            <Text size="xsmall" className="text-ui-fg-muted">
              {item.person_id}
            </Text>
          )}
        </div>

        {item.status === "failed" && (
          <div className="mb-3 flex items-start gap-x-2 rounded-lg bg-ui-bg-subtle px-3 py-2">
            <ExclamationCircle className="text-ui-fg-error mt-0.5 shrink-0" />
            <div className="flex-1">
              <Text size="small">{item.error || "Could not be read."}</Text>
              {onRetry && (
                <Button
                  size="small"
                  variant="transparent"
                  className="mt-1 px-0"
                  isLoading={isRetrying}
                  onClick={onRetry}
                >
                  Re-read this batch's failures
                </Button>
              )}
            </div>
          </div>
        )}

        {!draft && item.status !== "failed" && (
          <Text size="small" className="text-ui-fg-subtle">
            {item.status === "processing"
              ? "Being read now."
              : "Waiting its turn — photographs are read one at a time."}
          </Text>
        )}

        {draft && (
          <>
            {draft.warnings?.length ? (
              <ul className="mb-3 list-inside list-disc rounded-lg bg-ui-bg-subtle px-3 py-2">
                {draft.warnings.map((w, i) => (
                  <li key={i}>
                    <Text size="xsmall" className="text-ui-fg-subtle inline">
                      {w}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="First name"
                value={valueOf("first_name")}
                placeholder="Not read"
                disabled={locked}
                onChange={(v) => setField("first_name", v)}
              />
              <Field
                label="Last name"
                value={valueOf("last_name")}
                placeholder="Not read"
                disabled={locked}
                onChange={(v) => setField("last_name", v)}
              />
              <Field
                label="Gender"
                value={valueOf("gender")}
                placeholder="Not read"
                disabled={locked}
                onChange={(v) => setField("gender", v)}
              />
              <Field
                label="Date of birth"
                value={valueOf("date_of_birth")}
                placeholder="YYYY-MM-DD"
                disabled={locked}
                onChange={(v) => setField("date_of_birth", v)}
              />
              <Field
                label="ID type"
                value={valueOf("id_type")}
                placeholder="Not read"
                disabled={locked}
                onChange={(v) => setField("id_type", v)}
              />
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  ID number
                </Text>
                <Text size="small" className="py-1.5">
                  {/* Only the last four digits are ever stored, and they are
                      not editable — a corrected middle digit could not survive
                      into the record anyway. */}
                  {draft.id_number_masked || (draft.id_last4 ? `••••${draft.id_last4}` : "—")}
                </Text>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {EDITABLE_ADDRESS_FIELDS.map((f) => (
                <Field
                  key={f}
                  label={ADDRESS_LABELS[f]}
                  value={addressValueOf(f)}
                  placeholder="Not read"
                  disabled={locked}
                  onChange={(v) => setAddress(f, v)}
                />
              ))}
            </div>

            {!approvable && item.status !== "approved" && (
              <Text size="xsmall" className="text-ui-fg-error mt-3">
                A first or last name is needed before this one can be added.
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  )
}
