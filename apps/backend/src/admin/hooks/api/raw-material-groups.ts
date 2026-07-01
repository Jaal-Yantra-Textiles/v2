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
  specifications?: Record<string, unknown> | null
  unit_of_measure?: string
  status?: string
  // #829 — global specs the group holds once; new colors inherit these.
  unit_cost?: number | null
  cost_currency?: string | null
  lead_time_days?: number | null
  minimum_order_quantity?: number | null
  stock_location_id?: string | null
  material_type?: { id: string; name?: string; category?: string } | null
  material_type_id?: string | null
  raw_materials?: RawMaterialGroupColor[]
  created_at?: string
}

export interface GroupOrderLineRow {
  id: string
  quantity: number
  price: number
  color?: string | null
  material_name?: string | null
  raw_material_id?: string | null
  inventory_orders?: {
    id: string
    status?: string
    order_date?: string
    expected_delivery_date?: string
  } | null
}

const groupKeys = {
  all: ["raw-material-groups"] as const,
  list: (q?: Record<string, unknown>) => ["raw-material-groups", "list", q] as const,
  detail: (id: string) => ["raw-material-groups", "detail", id] as const,
  orders: (id: string) => ["raw-material-groups", "orders", id] as const,
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

export const useRawMaterialGroupOrders = (id?: string) =>
  useQuery({
    queryKey: groupKeys.orders(id!),
    enabled: !!id,
    queryFn: () =>
      sdk.client.fetch<{ order_lines: GroupOrderLineRow[] }>(
        `/admin/raw-material-groups/${id}/orders`
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

// #829 — update a group's fields (name/status + global specs set once).
export const useUpdateRawMaterialGroup = (groupId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ raw_material_group: RawMaterialGroup }>(
        `/admin/raw-material-groups/${groupId}`,
        { method: "POST", body }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: groupKeys.detail(groupId) })
      qc.invalidateQueries({ queryKey: groupKeys.all })
    },
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

// Full-detail color add — posts the shared RawMaterialForm's { rawMaterialData }.
export const useCreateGroupColorFull = (groupId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rawMaterialData: Record<string, unknown>) =>
      sdk.client.fetch<{ raw_material_group: RawMaterialGroup }>(
        `/admin/raw-material-groups/${groupId}/colors/full`,
        { method: "POST", body: { rawMaterialData } }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  })
}

// Attach existing raw_materials to the group as colors.
export const useLinkGroupColors = (groupId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (raw_material_ids: string[]) =>
      sdk.client.fetch<{ raw_material_group: RawMaterialGroup }>(
        `/admin/raw-material-groups/${groupId}/colors/link`,
        { method: "POST", body: { raw_material_ids } }
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
