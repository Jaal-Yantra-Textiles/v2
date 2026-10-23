import { Input, Select, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"

import { useProductionRuns } from "../../hooks/api/production-runs"

const NONE = "__none__"

/** A run's label as the team knows it: the design, then how many and its state. */
export const runLabel = (run: any) => {
  const name = run?.snapshot?.design?.name || run?.design_name || run?.design_id || "Run"
  const qty = run?.quantity != null ? ` · ${run.quantity} pcs` : ""
  return `${name}${qty} · ${run?.status ?? "-"} · …${String(run?.id ?? "").slice(-6)}`
}

type Props = {
  value?: string
  onChange: (id: string | undefined) => void
}

/**
 * Pick the production run a partner task is done for. Searches every run by
 * design, partner or product name (the list route's `q`).
 */
export const ProductionRunPicker = ({ value, onChange }: Props) => {
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { production_runs = [], isLoading } = useProductionRuns({
    limit: 20,
    ...(q ? { q } : {}),
  })

  return (
    <div className="flex flex-col gap-y-2">
      <Input
        placeholder="Search by design, partner or product"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
      />
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? undefined : v)}
      >
        <Select.Trigger>
          <Select.Value placeholder="Not for a production run" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value={NONE}>Not for a production run</Select.Item>
          {production_runs.map((run: any) => (
            <Select.Item key={run.id} value={run.id}>
              {runLabel(run)}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
      {isLoading && (
        <Text size="xsmall" className="text-ui-fg-subtle">
          Loading runs…
        </Text>
      )}
    </div>
  )
}
