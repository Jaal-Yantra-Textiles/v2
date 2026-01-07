import { RawMaterial } from "@lib/data/raw-materials"

export type InventoryItem = {
  id: string
  raw_materials?: RawMaterial
}

export type Partner = {
  id: string
  name?: string
  company_name?: string
  type?: string
  logo_url?: string
  description?: string
}

export type DesignTask = {
  id: string
  title?: string
  status?: string
}

export type Design = {
  id: string
  name?: string
  description?: string
  status?: string
  partners?: Partner[]
  inventory_items?: InventoryItem[]
  tasks?: DesignTask[]
}

export type DesignProduct = {
  id: string
  handle: string
  title: string
  thumbnail?: string | null
  description?: string
  designs?: Design[]
  metadata?: Record<string, any>
}

export type CustomerInfo = {
  id: string
  email: string
}

export type DesignLayer = {
  id: string
  type: "image" | "text"
  x: number
  y: number
  width?: number
  height?: number
  rotation: number
  scaleX: number
  scaleY: number
  src?: string
  text?: string
  fontSize?: number
  fontFamily?: string
  fontStyle?: string
  fill?: string
  draggable: boolean
  opacity: number
}

export type DesignState = {
  name: string
  layers: DesignLayer[]
  selectedId: string | null
  baseImage: HTMLImageElement | null
}

export type ViewState = {
  scale: number
  x: number
  y: number
}

export type BadgePreferences = {
  style: string | null
  colorPalette: string[]
  bodyType: string | null
  silhouette: string | null
  embellishment: string | null
  occasion: string[]
}

export type BadgeCategory = keyof BadgePreferences

export type SingleBadgeCategory = Exclude<BadgeCategory, "colorPalette" | "occasion">
export type MultiBadgeCategory = Extract<BadgeCategory, "colorPalette" | "occasion">

export type BadgeOption = {
  label: string
  value: string
  swatch?: string
  helper?: string
}
