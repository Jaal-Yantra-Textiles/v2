import { BadgePreferences, DesignLayer } from "../types"

const STORAGE_NAMESPACE = "design_editor_drafts"

type DraftBucket = Record<string, DesignDraft>

export type DesignDraft = {
  productId: string
  productHandle: string
  name?: string
  layers?: DesignLayer[]
  badges?: BadgePreferences
  selectedMaterialId?: string | null
  selectedPartnerId?: string | null
  savedAt: string
}

const safeParse = (value: string | null): DraftBucket => {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object") {
      return parsed as DraftBucket
    }
  } catch (err) {
    console.warn("Failed to parse design draft storage", err)
  }
  return {}
}

const writeBucket = (bucket: DraftBucket) => {
  try {
    localStorage.setItem(STORAGE_NAMESPACE, JSON.stringify(bucket))
  } catch (err) {
    console.warn("Unable to persist design drafts", err)
  }
}

export const saveDraft = (productId: string, draft: DesignDraft) => {
  if (typeof window === "undefined") return
  const bucket = safeParse(localStorage.getItem(STORAGE_NAMESPACE))
  bucket[productId] = draft
  writeBucket(bucket)
}

export const loadDraft = (productId: string): DesignDraft | null => {
  if (typeof window === "undefined") return null
  const bucket = safeParse(localStorage.getItem(STORAGE_NAMESPACE))
  return bucket[productId] || null
}

export const deleteDraft = (productId: string) => {
  if (typeof window === "undefined") return
  const bucket = safeParse(localStorage.getItem(STORAGE_NAMESPACE))
  if (bucket[productId]) {
    delete bucket[productId]
    writeBucket(bucket)
  }
}
