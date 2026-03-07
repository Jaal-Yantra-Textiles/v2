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
  images?: string[]
}

export type CustomerInfo = {
  id: string
  email: string
  aiFeaturesPaid?: boolean
}

export type DesignLayer = {
  id: string
  type: "image" | "text" | "rect" | "circle"
  x: number
  y: number
  width?: number
  height?: number
  rotation: number
  scaleX: number
  scaleY: number
  // image
  src?: string
  // text
  text?: string
  fontSize?: number
  fontFamily?: string
  fontStyle?: string
  textDecoration?: string
  textAlign?: "left" | "center" | "right"
  letterSpacing?: number
  lineHeight?: number
  // text + shape
  fill?: string
  // shape
  strokeColor?: string
  strokeWidth?: number
  cornerRadius?: number
  // all layers
  draggable: boolean
  opacity: number
  locked?: boolean
  blendMode?: string
}

export type DesignState = {
  name: string
  layers: DesignLayer[]
  selectedId: string | null
  baseImage: HTMLImageElement | null
  backgroundColor?: string
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

// AI Generation History Item
export type AiGenerationHistoryItem = {
  id: string
  preview_url: string
  prompt_used: string
  generated_at: string
  badges?: BadgePreferences
  materials_prompt?: string
}
