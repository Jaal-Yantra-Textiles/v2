import { useCallback, useEffect, useRef, useState } from "react"
import { DesignLayer, DesignProduct, DesignState, Partner, BadgePreferences } from "../../types"
import { RawMaterial } from "@lib/data/raw-materials"
import { loadDraft, saveDraft as persistDraft, deleteDraft, DesignDraft } from "../../utils/draft-storage"

const buildLayerlessSnapshot = (layers: DesignLayer[]): DesignLayer[] => layers.map((layer) => ({ ...layer }))

export type UseDesignDraftsArgs = {
  product: DesignProduct
  design: DesignState
  setDesign: React.Dispatch<React.SetStateAction<DesignState>>
  badgePreferences: BadgePreferences
  defaultBadgePreferences: BadgePreferences
  setBadgePreferences: React.Dispatch<React.SetStateAction<BadgePreferences>>
  selectedMaterial: RawMaterial | null
  setSelectedMaterial: React.Dispatch<React.SetStateAction<RawMaterial | null>>
  selectedPartner: Partner | null
  setSelectedPartner: React.Dispatch<React.SetStateAction<Partner | null>>
  externalMaterials: RawMaterial[]
  externalPartners: Partner[]
  setDesignName: React.Dispatch<React.SetStateAction<string>>
  setShowNameModal: React.Dispatch<React.SetStateAction<boolean>>
}

export type UseDesignDraftsResult = {
  persistDraftSnapshot: () => DesignDraft
  clearDraftSnapshot: () => void
}

export const useDesignDrafts = ({
  product,
  design,
  setDesign,
  badgePreferences,
  defaultBadgePreferences,
  setBadgePreferences,
  selectedMaterial,
  setSelectedMaterial,
  selectedPartner,
  setSelectedPartner,
  externalMaterials,
  externalPartners,
  setDesignName,
  setShowNameModal,
}: UseDesignDraftsArgs): UseDesignDraftsResult => {
  const hasHydratedDraftRef = useRef(false)
  const [pendingMaterialId, setPendingMaterialId] = useState<string | null>(null)
  const [pendingPartnerId, setPendingPartnerId] = useState<string | null>(null)

  const buildDraftPayload = useCallback((): DesignDraft => ({
    productId: product.id,
    productHandle: product.handle,
    name: design.name,
    layers: buildLayerlessSnapshot(design.layers),
    badges: badgePreferences,
    selectedMaterialId: selectedMaterial?.id ?? pendingMaterialId ?? null,
    selectedPartnerId: selectedPartner?.id ?? pendingPartnerId ?? null,
    savedAt: new Date().toISOString(),
  }), [
    product.id,
    product.handle,
    design.name,
    design.layers,
    badgePreferences,
    selectedMaterial?.id,
    selectedPartner?.id,
    pendingMaterialId,
    pendingPartnerId,
  ])

  const persistDraftSnapshot = useCallback(() => {
    const draft = buildDraftPayload()
    persistDraft(product.id, draft)
    return draft
  }, [buildDraftPayload, product.id])

  const clearDraftSnapshot = useCallback(() => {
    deleteDraft(product.id)
  }, [product.id])

  useEffect(() => {
    if (hasHydratedDraftRef.current) return
    const draft = loadDraft(product.id)
    hasHydratedDraftRef.current = true
    if (!draft) return

    setDesign((prev) => ({
      ...prev,
      name: draft.name || prev.name,
      layers: draft.layers || [],
    }))
    setDesignName(draft.name || "")
    if (draft.name) {
      setShowNameModal(false)
    }
    if (draft.badges) {
      setBadgePreferences((prev) => ({
        ...prev,
        ...draft.badges,
      }))
    } else {
      setBadgePreferences(defaultBadgePreferences)
    }

    if (draft.selectedMaterialId) {
      setPendingMaterialId(draft.selectedMaterialId)
    }
    if (draft.selectedPartnerId) {
      setPendingPartnerId(draft.selectedPartnerId)
    }
  }, [
    product.id,
    setDesign,
    setDesignName,
    setShowNameModal,
    setBadgePreferences,
    defaultBadgePreferences,
  ])

  useEffect(() => {
    if (!hasHydratedDraftRef.current) return
    persistDraftSnapshot()
  }, [
    persistDraftSnapshot,
    design.name,
    design.layers,
    badgePreferences,
    selectedMaterial?.id,
    selectedPartner?.id,
  ])

  useEffect(() => {
    if (!pendingMaterialId) return
    const material = externalMaterials.find((m) => m.id === pendingMaterialId)
    if (material) {
      setSelectedMaterial(material)
      setPendingMaterialId(null)
    }
  }, [pendingMaterialId, externalMaterials, setSelectedMaterial])

  useEffect(() => {
    if (!pendingPartnerId) return
    const partner = externalPartners.find((p) => p.id === pendingPartnerId)
    if (partner) {
      setSelectedPartner(partner)
      setPendingPartnerId(null)
    }
  }, [pendingPartnerId, externalPartners, setSelectedPartner])

  return {
    persistDraftSnapshot,
    clearDraftSnapshot,
  }
}
