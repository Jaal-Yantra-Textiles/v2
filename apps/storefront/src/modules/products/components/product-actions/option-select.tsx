import { HttpTypes } from "@medusajs/types"
import { clx } from "@medusajs/ui"
import React from "react"

type OptionSelectProps = {
  option: HttpTypes.StoreProductOption
  current: string | undefined
  updateOption: (title: string, value: string) => void
  title: string
  disabled: boolean
  "data-testid"?: string
}

/**
 * A colour carries its hex on the option value's `metadata`, which the Store
 * API already returns on its default field set — so the swatch costs no extra
 * request and no backend change.
 *
 * The name stays next to the swatch rather than being replaced by it: a bare
 * circle is unreadable to a screen reader and ambiguous between close shades,
 * and any value without a hex (Size, Material, or a colour an admin has not
 * given one yet) still has to render as a perfectly ordinary button.
 */
const hexOf = (value: unknown): string | null => {
  const hex = (value as any)?.metadata?.hex
  return typeof hex === "string" && /^#([0-9a-fA-F]{6})$/.test(hex) ? hex : null
}

/**
 * Option values are admin-entered and can be long ("Small Tunic — Kala Cotton
 * & Linen / Kala Cotton Red"). A fixed-height, equal-width button let that
 * spill out of its border. Long values take a full row, the label wraps to at
 * most two lines, and the full text stays available on hover and to screen
 * readers.
 */
const LONG_VALUE = 18

const OptionSelect: React.FC<OptionSelectProps> = ({
  option,
  current,
  updateOption,
  title,
  "data-testid": dataTestId,
  disabled,
}) => {
  const filteredOptions = (option.values ?? []).map((v) => ({
    value: v.value,
    hex: hexOf(v),
  }))

  return (
    <div className="flex flex-col gap-y-3">
      <span className="text-sm">Select {title}</span>
      <div
        className="flex flex-wrap gap-2"
        data-testid={dataTestId}
      >
        {filteredOptions.map((v) => {
          return (
            <button
              onClick={() => updateOption(option.id, v.value)}
              key={v.value}
              title={v.value}
              aria-label={v.value}
              className={clx(
                "border-ui-border-base bg-ui-bg-subtle border text-small-regular min-h-10 rounded-rounded px-3 py-2 flex-1 min-w-[4.5rem] max-w-full flex items-center justify-center gap-x-2 text-center leading-tight",
                {
                  "basis-full": v.value.length > LONG_VALUE,
                  "border-ui-border-interactive": v.value === current,
                  "hover:shadow-elevation-card-rest transition-shadow ease-in-out duration-150":
                    v.value !== current,
                }
              )}
              disabled={disabled}
              data-testid="option-button"
            >
              {v.hex && (
                <span
                  aria-hidden="true"
                  className="inline-block size-4 shrink-0 rounded-full border border-ui-border-base"
                  style={{ backgroundColor: v.hex }}
                />
              )}
              <span className="min-w-0 break-words line-clamp-2">{v.value}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default OptionSelect
