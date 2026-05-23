"use client"

import { useEffect, useImperativeHandle, useState, type Ref } from "react"
import { Heading, Input, Label, Text } from "@medusajs/ui"
import {
  savePreferences,
  type AiChatPreferences,
  type ChatFit,
} from "@lib/util/ai-chat-preferences"

/**
 * One-screen onboarding capture rendered the first time a customer
 * opens the chat. Captures a thin profile (colors / materials / fit /
 * size / price range) so the agent can personalise from turn one
 * instead of asking onboarding-style questions in chat.
 *
 * Renders only the FORM BODY (no header, no action buttons). The
 * parent owns FocusModal layout and renders the action buttons in
 * FocusModal.Footer so they stay pinned. Submit/skip are exposed via
 * `ref.current.submit()` / `ref.current.skip()`.
 *
 * "Skip" is intentional. Shoppers who'd rather just chat shouldn't
 * have to fill anything. `onboarded` is set either way so we don't
 * ask again.
 */

const COLOR_OPTIONS = [
  "ivory",
  "natural",
  "indigo",
  "rust",
  "olive",
  "black",
  "saffron",
  "rose",
]
const STYLE_OPTIONS = ["minimal", "bohemian", "structured", "drapey"]
const MATERIAL_OPTIONS = ["cotton", "silk", "linen", "muslin"]
const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL"]
const FIT_OPTIONS: ChatFit[] = ["relaxed", "fitted"]

export type OnboardingHandle = {
  submit: () => void
  skip: () => void
}

type Props = {
  initial?: AiChatPreferences
  onDone: (prefs: AiChatPreferences) => void
  onSkip: () => void
  /**
   * Notifies the parent when the form transitions between clean and
   * dirty. The parent uses this to gate the unsaved-changes Prompt on
   * close attempts.
   */
  onDirtyChange?: (dirty: boolean) => void
  ref?: Ref<OnboardingHandle>
}

const toggleIn = (list: string[] | undefined, value: string): string[] => {
  const current = list ?? []
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value]
}

export default function OnboardingForm({
  initial,
  onDone,
  onSkip,
  onDirtyChange,
  ref,
}: Props) {
  const [colors, setColors] = useState<string[]>(initial?.colors ?? [])
  const [styles, setStyles] = useState<string[]>(initial?.styles ?? [])
  const [materials, setMaterials] = useState<string[]>(initial?.materials ?? [])
  const [size, setSize] = useState<string | undefined>(initial?.body?.size)
  const [fit, setFit] = useState<ChatFit | undefined>(initial?.body?.fit)
  const [maxPrice, setMaxPrice] = useState<number | undefined>(
    initial?.price_range?.max
  )

  // Dirty when any field has been edited away from the initial value.
  // Shallow set-equality is enough for the chip groups (no duplicates,
  // unordered semantics, small lists).
  const sameSet = (a: string[], b: string[] | undefined) => {
    const other = b ?? []
    if (a.length !== other.length) return false
    return a.every((v) => other.includes(v))
  }
  const dirty =
    !sameSet(colors, initial?.colors) ||
    !sameSet(styles, initial?.styles) ||
    !sameSet(materials, initial?.materials) ||
    size !== initial?.body?.size ||
    fit !== initial?.body?.fit ||
    maxPrice !== initial?.price_range?.max

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const submit = () => {
    const next: AiChatPreferences = {
      colors: colors.length ? colors : undefined,
      styles: styles.length ? styles : undefined,
      materials: materials.length ? materials : undefined,
      body: size || fit ? { size, fit } : undefined,
      price_range: maxPrice ? { max: maxPrice } : undefined,
      onboarded: true,
    }
    savePreferences(next)
    onDone(next)
  }

  const skip = () => {
    savePreferences({ onboarded: true })
    onSkip()
  }

  useImperativeHandle(ref, () => ({ submit, skip }), [submit, skip])

  return (
    <div className="space-y-6 px-6 py-6">
      <div>
        <Heading level="h2" className="text-ui-fg-base">
          Hey there — quick intro?
        </Heading>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          Tell us a little about what you like so we can show you the right
          pieces. Skip if you&apos;d rather just chat.
        </Text>
      </div>

      <ChipGroup
        label="Colors you reach for"
        options={COLOR_OPTIONS}
        selected={colors}
        onToggle={(v) => setColors((s) => toggleIn(s, v))}
      />
      <ChipGroup
        label="Materials you like"
        options={MATERIAL_OPTIONS}
        selected={materials}
        onToggle={(v) => setMaterials((s) => toggleIn(s, v))}
      />
      <ChipGroup
        label="Style"
        options={STYLE_OPTIONS}
        selected={styles}
        onToggle={(v) => setStyles((s) => toggleIn(s, v))}
      />

      <div>
        <Label size="small" weight="plus" className="text-ui-fg-base">
          Usual size
        </Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {SIZE_OPTIONS.map((s) => (
            <Chip
              key={s}
              label={s}
              selected={size === s}
              onClick={() => setSize(size === s ? undefined : s)}
            />
          ))}
        </div>
      </div>

      <div>
        <Label size="small" weight="plus" className="text-ui-fg-base">
          Fit preference
        </Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {FIT_OPTIONS.map((f) => (
            <Chip
              key={f}
              label={f}
              selected={fit === f}
              onClick={() => setFit(fit === f ? undefined : f)}
            />
          ))}
        </div>
      </div>

      <div>
        <Label
          htmlFor="ai-chat-max-price"
          size="small"
          weight="plus"
          className="text-ui-fg-base"
        >
          Comfortable spend per piece (optional)
        </Label>
        <div className="mt-2 flex items-center gap-2">
          <Text size="small" className="text-ui-fg-subtle">
            up to
          </Text>
          <Input
            id="ai-chat-max-price"
            type="number"
            inputMode="numeric"
            min={500}
            max={50000}
            step={500}
            placeholder="e.g. 5000"
            value={maxPrice ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value)
              setMaxPrice(Number.isFinite(n) && n > 0 ? Math.round(n) : undefined)
            }}
            className="w-36"
          />
        </div>
      </div>
    </div>
  )
}

const ChipGroup = ({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
}) => (
  <div>
    <Label size="small" weight="plus" className="text-ui-fg-base">
      {label}
    </Label>
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip
          key={o}
          label={o}
          selected={selected.includes(o)}
          onClick={() => onToggle(o)}
        />
      ))}
    </div>
  </div>
)

const Chip = ({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1.5 text-sm transition ${
      selected
        ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
        : "border-ui-border-base bg-ui-bg-base text-ui-fg-base hover:border-ui-border-strong"
    }`}
  >
    {label}
  </button>
)
