import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Combobox } from "../../../../components/inputs/combobox/combobox"
import { sdk } from "../../../../lib/config"

export type PartnerPick = { id: string; name: string }

/** Search every partner on file, by name or handle. */
const usePartnerSearch = (q: string) =>
  useQuery({
    queryKey: ["brief_partner_search", q],
    queryFn: () =>
      sdk.client.fetch<{ partners: { id: string; name: string; handle: string }[] }>("/admin/partners", {
        query: { limit: 20, fields: "id,name,handle", ...(q ? { q } : {}) },
      }),
    placeholderData: keepPreviousData,
  })

/**
 * Partners in a Combobox (#2608). Picked partners stay in the option list so
 * their names still show once the search has moved on.
 */
export const PartnerCombobox = ({
  value,
  onChange,
  placeholder = "Search partners",
}: {
  value: PartnerPick[]
  onChange: (next: PartnerPick[]) => void
  placeholder?: string
}) => {
  const [search, setSearch] = useState("")
  const { data } = usePartnerSearch(search)

  const options = useMemo(() => {
    const byId = new Map<string, string>(value.map((p) => [p.id, p.name]))
    for (const p of data?.partners ?? []) byId.set(p.id, p.name || p.handle)
    return [...byId].map(([id, name]) => ({ value: id, label: name }))
  }, [data, value])

  const names = new Map(options.map((o) => [o.value, o.label]))
  return (
    <Combobox
      value={value.map((p) => p.id)}
      onChange={(ids) => onChange(((ids as string[]) ?? []).map((id) => ({ id, name: names.get(id) ?? id })))}
      searchValue={search}
      onSearchValueChange={setSearch}
      options={options}
      placeholder={placeholder}
    />
  )
}

/** One partner (the lead). */
export const SinglePartnerCombobox = ({
  value,
  onChange,
}: {
  value: PartnerPick | null
  onChange: (next: PartnerPick | null) => void
}) => {
  const [search, setSearch] = useState("")
  const { data } = usePartnerSearch(search)
  const options = useMemo(() => {
    const byId = new Map<string, string>(value ? [[value.id, value.name]] : [])
    for (const p of data?.partners ?? []) byId.set(p.id, p.name || p.handle)
    return [...byId].map(([id, name]) => ({ value: id, label: name }))
  }, [data, value])

  return (
    <Combobox
      value={value?.id ?? ""}
      onChange={(id) => {
        const picked = options.find((o) => o.value === id)
        onChange(picked ? { id: picked.value, name: picked.label } : null)
      }}
      searchValue={search}
      onSearchValueChange={setSearch}
      options={options}
      allowClear
      placeholder="Search partners"
    />
  )
}
