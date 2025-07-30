export type StoreRawMaterial = {
  id: string
  name: string
  description: string | null
  material_type: {
    name: string
    category: string
  }
  supplier: {
    name: string
  }
  sku: string | null
  color: string | null
  country_of_origin: string | null
  composition: string | null
  weave: string | null
  gsm: number | null
  certifications: string[] | null
  sustainability_metrics: string[] | null
  price_per_unit: number | null
  currency_code: string | null
  grade: string | null
  status: string
  unit_of_measure: string | null
  weight: number | null
  width: number | null
  lead_time_days: number | null
  minimum_order_quantity: number | null
}

export type StoreInventoryItem = {
  id: string
  raw_materials?: StoreRawMaterial
}

export type StoreTask = {
  id: string
  title: string
  status: string
}

export type StoreDesign = {
  id: string
  name: string
  description: string | null
  design_type?: string
  status?: string
  priority?: string
  tags?: string[] | null
  images?: { url: string }[]
  partners?: { name: string }[] | null
  tasks?: StoreTask[] | null
  color_palette?: { name: string; code: string }[] | null
  inventory_items?: StoreInventoryItem[] | null
}
