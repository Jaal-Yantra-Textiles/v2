"use client"

import { useState } from "react"
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
 * "Skip" is intentional and prominent: shoppers who'd rather just
 * chat shouldn't have to fill anything. `onboarded` is set either way
 * so we don't ask again.
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

type Props = {
  initial?: AiChatPreferences
  onDone: (prefs: AiChatPreferences) => void
  onSkip: () => void
}

const toggleIn = (list: string[] | undefined, value: string): string[] => {
  const current = list ?? []
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value]
}

export default function OnboardingForm({ initial, onDone, onSkip }: Props) {
  const [colors, setColors] = useState<string[]>(initial?.colors ?? [])
  const [styles, setStyles] = useState<string[]>(initial?.styles ?? [])
  const [materials, setMaterials] = useState<string[]>(initial?.materials ?? [])
  const [size, setSize] = useState<string | undefined>(initial?.body?.size)
  const [fit, setFit] = useState<ChatFit | undefined>(initial?.body?.fit)
  const [maxPrice, setMaxPrice] = useState<number | undefined>(
    initial?.price_range?.max
  )

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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <h2 className="text-lg font-medium text-neutral-900 sm:text-xl">
          Hey there — quick intro?
        </h2>
        <p className="mt-1 text-sm text-neutral-500 sm:text-base">
          Tell us a little about what you like so we can show you the right
          pieces. Skip if you'd rather just chat.
        </p>
      </div>

      <div className="flex-1 space-y-5 px-4 pb-4 sm:px-6 sm:pb-5">
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
          <p className="mb-2 text-sm font-medium text-neutral-700">
            Usual size
          </p>
          <div className="flex flex-wrap gap-2">
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
          <p className="mb-2 text-sm font-medium text-neutral-700">
            Fit preference
          </p>
          <div className="flex flex-wrap gap-2">
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
          <label className="mb-2 block text-sm font-medium text-neutral-700">
            Comfortable spend per piece (optional)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-500">up to</span>
            <input
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
              className="w-36 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-neutral-200 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            className="flex-1 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 sm:text-base"
          >
            Looks good
          </button>
          <button
            type="button"
            onClick={skip}
            className="rounded-full px-4 py-2.5 text-sm text-neutral-500 hover:text-neutral-900 sm:text-base"
          >
            Skip
          </button>
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
    <p className="mb-2 text-sm font-medium text-neutral-700">{label}</p>
    <div className="flex flex-wrap gap-2">
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
        ? "border-neutral-900 bg-neutral-900 text-white"
        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
    }`}
  >
    {label}
  </button>
)
