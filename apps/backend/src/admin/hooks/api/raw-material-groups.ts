import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

// #817 S3 — raw-material groups: the "product" parents that tie per-color
// raw_materials together, plus the group-ordering (fan-out) surface.

export interface RawMaterialGroupColor {
  id: string
  name: string
  color?: string | null
  status?: string
  inventory_item?: { id: string; sku?: string } | null
}

export interface RawMaterialGroup {
  id: string
  name: string
  description?: string | null
  composition?: string | null
  unit_of_measure?: string
  status?: string
  material_type?: { id: string; name?: string; category?: string } | null
  raw_materials?: RawMaterialGroupColor[]
  created_at?: string
}

const groupKeys = {
  all: ["raw-material-groups"] as const,
  list: (q?: Record<string, unknown>) => ["raw-material-groups", "list", q] as const,
  detail: (id: string) => ["raw-material-groups", "detail", id] as const,
}

export const useRawMaterialGroups = (query?: {
  q?: string
  status?: string
  limit?: number
  offset?: number
}) =>
  useQuery({
    queryKey: groupKeys.list(query),
    queryFn: () =>
      sdk.client.fetch<{
        raw_material_groups: RawMaterialGroup[]
        count: number
        offset: number
        limit: number
      }>("/admin/raw-material-groups", { query: query as any }),
  })

export const useRawMaterialGroup = (id?: string) =>
  useQuery({
    queryKey: groupKeys.detail(id!),
    enabled: !!id,
    queryFn: () =>
      sdk.client.fetch<{ raw_material_group: RawMaterialGroup }>(
        `/admin/raw-material-groups/${id}`
      ),
  })

export const useCreateRawMaterialGroup = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ raw_material_group: RawMaterialGroup }>(
        "/admin/raw-material-groups",
        { method: "POST", body }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupKeys.all }),
  })
}

export const useAddGroupColor = (groupId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ raw_material_group: RawMaterialGroup }>(
        `/admin/raw-material-groups/${groupId}/colors`,
        { method: "POST", body }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  })
}

export type GroupOrderLine = {
  raw_material_id: string
  quantity: number
  price: number
}

export const useCreateGroupOrder = (groupId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{
        inventoryOrder: { id: string }
        created_inventory_item_ids: string[]
      }>(`/admin/raw-material-groups/${groupId}/orders`, {
        method: "POST",
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  })
}
