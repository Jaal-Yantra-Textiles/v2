"use client"

import { Text, clx } from "@medusajs/ui"

import type { StoreProductSpec } from "@lib/data/product-spec"

import type { SpecChoiceState } from "./spec-choices-util"

/**
 * #1365 — the made-to-order choice inputs, as a CONTROLLED component.
 *
 * It owns no state. The buying column (between the variant selector and the
 * price) and the second step at /customise render the identical inputs from the
 * identical state, so a customer who overflows to the wider page is not looking
 * at a second, subtly different form.
 *
 * The palette rendered here is only what the storefront was told is available;
 * the backend re-checks the choice on submit, so a stale page cannot place an
 * order for a colour the partner has since withdrawn.
 */

type Props = {
  spec: StoreProductSpec
  value: SpecChoiceState
  onChange: (next: SpecChoiceState) => void
  disabled?: boolean
  /** The note box is a lot of vertical weight for a 300px column. */
  showNote?: boolean
  layout?: "column" | "wide"
}

const SpecChoices = ({
  spec,
  value,
  onChange,
  disabled,
  showNote = true,
  layout = "column",
}: Props) => {
  const setColor = (color: string | null) => onChange({ ...value, color })

  const setOption = (key: string, label: string | null) => {
    const options = { ...value.options }
    if (label === null) {
      delete options[key]
    } else {
      options[key] = label
    }
    onChange({ ...value, options })
  }

  return (
    <div
      className={clx(
        "flex flex-col gap-y-4",
        layout === "wide" && "small:gap-y-6"
      )}
      data-testid="spec-choices"
    >
      {!!spec.colors.length && (
        <div className="flex flex-col gap-y-2" data-testid="spec-choice-colour">
          <Text size="small" className="text-ui-fg-subtle">
            Colour{value.color ? ` — ${value.color}` : ""}
          </Text>
          <div className="flex flex-wrap gap-2">
            {/* Colour needs a way back to "not chosen" — with one button, an
             *  irreversible first tap would lock the customer into a
             *  made-to-order purchase they only meant to look at. */}
            <button
              type="button"
              disabled={disabled}
              aria-pressed={!value.color}
              onClick={() => setColor(null)}
              data-testid="spec-choice-colour-none"
              className={clx(
                "rounded-full border px-3 py-1 transition-colors",
                !value.color
                  ? "border-ui-fg-base bg-ui-bg-base"
                  : "border-ui-border-base bg-ui-bg-subtle hover:border-ui-fg-muted"
              )}
            >
              <Text size="small">As shown</Text>
            </button>
            {spec.colors.map((option) => {
              const selected = option.name === value.color
              return (
                <button
                  key={option.id ?? option.name}
                  type="button"
                  disabled={disabled}
                  onClick={() => setColor(option.name)}
                  aria-pressed={selected}
                  // The name is in the label, not only the swatch — a palette
                  // told apart by colour alone is unusable to anyone who
                  // cannot distinguish the swatches.
                  aria-label={
                    option.usage_notes
                      ? `${option.name} — ${option.usage_notes}`
                      : option.name
                  }
                  title={option.usage_notes ?? option.name}
                  className={clx(
                    "flex items-center gap-x-2 rounded-full border py-1 pl-1 pr-3 transition-colors",
                    selected
                      ? "border-ui-fg-base bg-ui-bg-base"
                      : "border-ui-border-base bg-ui-bg-subtle hover:border-ui-fg-muted"
                  )}
                >
                  <span
                    className="border-ui-border-base size-6 rounded-full border"
                    style={{
                      backgroundColor: option.hex_code ?? "transparent",
                    }}
                    aria-hidden
                  />
                  <Text size="small">{option.name}</Text>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {(spec.options ?? []).map((option) => (
        <div
          key={option.key}
          className="flex flex-col gap-y-2"
          data-testid={`spec-choice-${option.key}`}
        >
          <div className="flex flex-col">
            <Text size="small" className="text-ui-fg-subtle">
              {option.label}
              {option.required ? "" : " (optional)"}
            </Text>
            {option.help_text && (
              <Text size="xsmall" className="text-ui-fg-muted">
                {option.help_text}
              </Text>
            )}
          </div>

          {!option.values.length ? (
            <Text size="small" className="text-ui-fg-error">
              None of the {option.label.toLowerCase()} choices can be made at the
              moment.
            </Text>
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* An optional group needs a way BACK to "not chosen". Without it
               *  the first tap is irreversible, which is the same trap as
               *  pre-selecting. */}
              {(option.required
                ? option.values
                : [
                    { id: `${option.key}-none`, label: "", note: null },
                    ...option.values,
                  ]
              ).map((optionValue) => {
                const isClear = optionValue.label === ""
                const isSelected = isClear
                  ? !value.options[option.key]
                  : value.options[option.key] === optionValue.label
                return (
                  <button
                    key={optionValue.id ?? optionValue.label}
                    type="button"
                    disabled={disabled}
                    aria-pressed={isSelected}
                    onClick={() =>
                      setOption(option.key, isClear ? null : optionValue.label)
                    }
                    title={optionValue.note ?? undefined}
                    className={clx(
                      "rounded-full border px-3 py-1 text-left transition-colors",
                      isSelected
                        ? "border-ui-fg-base bg-ui-bg-base"
                        : "border-ui-border-base bg-ui-bg-subtle hover:border-ui-fg-muted"
                    )}
                  >
                    <Text size="small">
                      {isClear ? "No thanks" : optionValue.label}
                    </Text>
                    {optionValue.note && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {optionValue.note}
                      </Text>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}

      {showNote && (
        <div className="flex flex-col gap-y-2">
          <Text size="small" className="text-ui-fg-subtle">
            Anything we should know? (optional)
          </Text>
          <textarea
            rows={2}
            maxLength={500}
            disabled={disabled}
            value={value.note}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
            placeholder="For a September wedding — a wider border if possible."
            className="border-ui-border-base bg-ui-bg-field rounded-md border px-3 py-2 text-sm"
            data-testid="spec-choice-note"
          />
        </div>
      )}
    </div>
  )
}

export default SpecChoices
