import { Badge, Button, FocusModal, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useMemo, useState } from "react"

import {
  useConstructionTechniques,
  useCreateConstructionDetail,
  type ConstructionPreset,
  type ConstructionTechnique,
} from "../../../hooks/api/partner-designs"

/** Parse a textarea into a trimmed, non-empty list (one rule per line). */
const parseLines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

type Props = {
  designId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a detail is created so the parent can refresh the canvas frame. */
  onAdded: () => void
}

/**
 * #1113 Feature B — categorized construction picker. Pick a technique (grouped by
 * family), which auto-fills its params + default fabric rules; presets fully
 * pre-fill the form. Creating a detail persists it and hands control back so the
 * moodboard refreshes its construction glyph.
 */
export const ConstructionPicker = ({ designId, open, onOpenChange, onAdded }: Props) => {
  const { data: catalog, isPending } = useConstructionTechniques(designId, {
    enabled: open && !!designId,
  })
  const { mutateAsync: createDetail, isPending: isCreating } =
    useCreateConstructionDetail(designId)

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [label, setLabel] = useState("")
  const [note, setNote] = useState("")
  const [params, setParams] = useState<Record<string, number>>({})
  const [rulesText, setRulesText] = useState("")

  const techniques = catalog?.techniques ?? []
  const families = catalog?.families ?? []

  const selected: ConstructionTechnique | undefined = useMemo(
    () => techniques.find((t) => t.slug === selectedSlug),
    [techniques, selectedSlug]
  )

  const grouped = useMemo(() => {
    const byFamily: Record<string, ConstructionTechnique[]> = {}
    for (const t of techniques) {
      ;(byFamily[t.family] ??= []).push(t)
    }
    return families
      .filter((f) => byFamily[f]?.length)
      .map((f) => ({ family: f, items: byFamily[f] }))
  }, [techniques, families])

  // Choosing a technique auto-fills params (defaults) + default fabric rules.
  const chooseTechnique = (t: ConstructionTechnique) => {
    setSelectedSlug(t.slug)
    setLabel(t.label)
    setNote("")
    setParams(Object.fromEntries(t.params.map((p) => [p.key, p.default])))
    setRulesText(t.defaultFabricRules.join("\n"))
  }

  // A preset fully pre-fills the form on top of its technique.
  const applyPreset = (t: ConstructionTechnique, preset: ConstructionPreset) => {
    setSelectedSlug(t.slug)
    setLabel(preset.detailLabel || t.label)
    setNote(preset.note ?? "")
    setParams({
      ...Object.fromEntries(t.params.map((p) => [p.key, p.default])),
      ...(preset.params ?? {}),
    })
    setRulesText((preset.fabricRules ?? t.defaultFabricRules).join("\n"))
  }

  const reset = () => {
    setSelectedSlug(null)
    setLabel("")
    setNote("")
    setParams({})
    setRulesText("")
  }

  const handleAdd = async () => {
    if (!selected) {
      return
    }
    try {
      await createDetail({
        technique: selected.slug,
        label: label.trim() || undefined,
        params: Object.keys(params).length ? params : undefined,
        fabricRules: parseLines(rulesText).length ? parseLines(rulesText) : undefined,
        note: note.trim() || undefined,
      })
      toast.success(`Added "${label.trim() || selected.label}"`)
      reset()
      onOpenChange(false)
      onAdded()
    } catch (err: any) {
      toast.error(err?.message || "Failed to add construction detail")
    }
  }

  return (
    <FocusModal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset()
        }
        onOpenChange(o)
      }}
    >
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading level="h2">Add construction detail</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="flex min-h-0 flex-1 overflow-hidden">
          {isPending ? (
            <div className="p-6">
              <Text size="small" className="text-ui-fg-subtle">
                Loading techniques…
              </Text>
            </div>
          ) : (
            <div className="flex h-full w-full min-h-0">
              {/* Left — categorized technique catalog */}
              <div className="w-1/2 min-h-0 overflow-y-auto border-r p-6">
                {grouped.map((grp) => (
                  <div key={grp.family} className="mb-6">
                    <Text
                      size="xsmall"
                      weight="plus"
                      className="text-ui-fg-muted mb-2 uppercase"
                    >
                      {grp.family}
                    </Text>
                    <div className="flex flex-col gap-y-3">
                      {grp.items.map((t) => (
                        <div
                          key={t.slug}
                          className={`rounded-lg border p-3 ${
                            selectedSlug === t.slug
                              ? "border-ui-border-interactive bg-ui-bg-base-pressed"
                              : "border-ui-border-base"
                          }`}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center justify-between text-left"
                            onClick={() => chooseTechnique(t)}
                          >
                            <Text size="small" weight="plus">
                              {t.label}
                            </Text>
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {t.garmentAreas.join(" · ")}
                            </Text>
                          </button>
                          {t.presets.length ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {t.presets.map((p) => (
                                <button
                                  key={p.value}
                                  type="button"
                                  onClick={() => applyPreset(t, p)}
                                >
                                  <Badge size="2xsmall" className="cursor-pointer">
                                    {p.label}
                                  </Badge>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right — auto-filled form for the chosen technique */}
              <div className="w-1/2 min-h-0 overflow-y-auto p-6">
                {!selected ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    Pick a technique or a preset on the left — its parameters and
                    fabric rules auto-fill here.
                  </Text>
                ) : (
                  <div className="flex flex-col gap-y-4">
                    <div className="flex flex-col gap-y-1">
                      <Label size="small">Label</Label>
                      <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder={selected.label}
                      />
                    </div>

                    {selected.params.length ? (
                      <div className="flex flex-col gap-y-2">
                        <Label size="small">Parameters</Label>
                        {selected.params.map((p) => (
                          <div key={p.key} className="flex items-center gap-x-3">
                            <Text size="small" className="w-32 shrink-0">
                              {p.label}
                            </Text>
                            <Input
                              type="number"
                              min={p.min}
                              max={p.max}
                              step={p.step}
                              value={params[p.key] ?? p.default}
                              onChange={(e) =>
                                setParams((prev) => ({
                                  ...prev,
                                  [p.key]: Number(e.target.value),
                                }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        This technique has fixed geometry — no parameters to set.
                      </Text>
                    )}

                    <div className="flex flex-col gap-y-1">
                      <Label size="small">Fabric / sewing rules</Label>
                      <Textarea
                        rows={4}
                        value={rulesText}
                        onChange={(e) => setRulesText(e.target.value)}
                        placeholder="one rule per line"
                      />
                    </div>

                    <div className="flex flex-col gap-y-1">
                      <Label size="small">Note</Label>
                      <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="optional"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <Button
              size="small"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={handleAdd}
              disabled={!selected || isCreating}
              isLoading={isCreating}
            >
              Add detail
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
