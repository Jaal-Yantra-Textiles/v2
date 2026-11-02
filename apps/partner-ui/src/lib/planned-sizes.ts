/**
 * #2500 — a run's planned split (`planned_output`), as the partner reads it
 * BEFORE completing: "38×1, 40×1", or "M Black×2" when a line names a colour.
 *
 * Until now the plan was only used to prefill the completion form, so a partner
 * who accepted a bundle saw "Qty 2" and had to find the sizes in WhatsApp.
 *
 * Returns null when there is nothing worth showing: no plan, or a plan that is
 * a single line with no size or colour (that is just the quantity again).
 */
export const formatPlannedOutput = (lines: unknown): string | null => {
  if (!Array.isArray(lines)) return null
  const parts = (lines as any[])
    .filter((l) => l && Number(l.quantity) > 0)
    .map((l) => {
      const label = [l.size_label, l.color]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean)
        .join(" ")
      return { label, quantity: Number(l.quantity) }
    })
  if (!parts.length || parts.every((p) => !p.label)) return null
  return parts
    .map((p) => `${p.label || "Any"}×${Number.isInteger(p.quantity) ? p.quantity : Math.round(p.quantity * 100) / 100}`)
    .join(", ")
}
