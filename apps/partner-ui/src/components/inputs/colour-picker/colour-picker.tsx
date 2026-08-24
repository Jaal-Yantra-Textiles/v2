import { Button, Input, Text, Tooltip, clx } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import type { PaletteValue } from "../../../hooks/api/products"

export type ColourEntry = string | { value: string; hex: string }

type ColourPickerProps = {
  /** Palette values the partner may choose from — curated plus their own. */
  palette: PaletteValue[]
  value?: ColourEntry[]
  onChange: (value: ColourEntry[]) => void
  disabled?: boolean
}

const nameOf = (entry: ColourEntry) =>
  typeof entry === "string" ? entry : entry.value

const HEX = /^#([0-9a-fA-F]{6})$/

/**
 * Pick colours for a product from the shared palette.
 *
 * The swatch is the point: a colour name with no hex is unreadable to a buyer,
 * which is why a colour added here must carry one. Selection is by name — the
 * backend resolves names to the shared option's value ids, so the product ends
 * up linked to the same "Terracotta" every other product uses rather than a
 * private copy that drifts.
 */
export const ColourPicker = ({
  palette,
  value = [],
  onChange,
  disabled,
}: ColourPickerProps) => {
  const { t } = useTranslation()
  const [customName, setCustomName] = useState("")
  const [customHex, setCustomHex] = useState("#BF7B61")

  const selected = useMemo(
    () => new Set(value.map((v) => nameOf(v).toLowerCase())),
    [value]
  )

  // Pending additions are not in the palette yet — show them alongside it so a
  // partner can see and unpick a colour they just added but have not saved.
  const pending = useMemo(
    () =>
      value.filter(
        (v) =>
          typeof v !== "string" &&
          !palette.some(
            (p) => p.value.toLowerCase() === v.value.toLowerCase()
          )
      ) as { value: string; hex: string }[],
    [value, palette]
  )

  const toggle = (name: string) => {
    if (disabled) {
      return
    }
    if (selected.has(name.toLowerCase())) {
      onChange(value.filter((v) => nameOf(v).toLowerCase() !== name.toLowerCase()))
      return
    }
    onChange([...value, name])
  }

  const addCustom = () => {
    const name = customName.trim()
    if (!name || !HEX.test(customHex) || selected.has(name.toLowerCase())) {
      return
    }
    onChange([...value, { value: name, hex: customHex }])
    setCustomName("")
  }

  const swatches: { value: string; hex: string | null; custom: boolean }[] = [
    ...palette,
    ...pending.map((p) => ({ value: p.value, hex: p.hex, custom: true })),
  ]

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-wrap gap-2">
        {swatches.map((swatch) => {
          const isSelected = selected.has(swatch.value.toLowerCase())
          return (
            <Tooltip key={swatch.value} content={swatch.value}>
              <button
                type="button"
                aria-label={swatch.value}
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => toggle(swatch.value)}
                className={clx(
                  "size-7 rounded-full border transition-all",
                  "border-ui-border-base",
                  isSelected &&
                    "ring-2 ring-ui-fg-interactive ring-offset-2 ring-offset-ui-bg-base",
                  disabled && "cursor-not-allowed opacity-50"
                )}
                style={{ backgroundColor: swatch.hex ?? "transparent" }}
              />
            </Tooltip>
          )
        })}
      </div>

      {!!value.length && (
        <Text size="small" className="text-ui-fg-subtle">
          {value.map((v) => nameOf(v)).join(", ")}
        </Text>
      )}

      <div className="flex items-center gap-x-2">
        <Input
          size="small"
          placeholder={t(
            "products.fields.options.customColourPlaceholder",
            "Add another colour"
          )}
          value={customName}
          disabled={disabled}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Otherwise Enter submits the drawer with a half-typed colour.
              e.preventDefault()
              addCustom()
            }
          }}
        />
        <input
          type="color"
          aria-label={t("products.fields.options.customColourHex", "Colour")}
          value={customHex}
          disabled={disabled}
          onChange={(e) => setCustomHex(e.target.value)}
          className="size-8 shrink-0 cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-field p-0.5"
        />
        <Button
          type="button"
          size="small"
          variant="secondary"
          disabled={disabled || !customName.trim()}
          onClick={addCustom}
        >
          {t("actions.add", "Add")}
        </Button>
      </div>
    </div>
  )
}
