import { useEffect, useState } from "react"
import { listRawMaterials, RawMaterial } from "@lib/data/raw-materials"
import { listPartners } from "@lib/data/partners"
import { Partner } from "../../types"

type UseExternalResourcesResult = {
  selectedMaterial: RawMaterial | null
  setSelectedMaterial: React.Dispatch<React.SetStateAction<RawMaterial | null>>
  showMaterialModal: boolean
  setShowMaterialModal: React.Dispatch<React.SetStateAction<boolean>>
  externalMaterials: RawMaterial[]
  materialsLoading: boolean
  materialsError: string | null
  selectedPartner: Partner | null
  setSelectedPartner: React.Dispatch<React.SetStateAction<Partner | null>>
  showPartnerModal: boolean
  setShowPartnerModal: React.Dispatch<React.SetStateAction<boolean>>
  externalPartners: Partner[]
  partnersLoading: boolean
}

export const useExternalResources = (): UseExternalResourcesResult => {
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null)
  const [showMaterialModal, setShowMaterialModal] = useState(false)
  const [externalMaterials, setExternalMaterials] = useState<RawMaterial[]>([])
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)

  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
  const [showPartnerModal, setShowPartnerModal] = useState(false)
  const [externalPartners, setExternalPartners] = useState<Partner[]>([])
  const [partnersLoading, setPartnersLoading] = useState(false)

  useEffect(() => {
    const fetchMaterials = async () => {
      setMaterialsLoading(true)
      setMaterialsError(null)
      try {
        const { raw_materials } = await listRawMaterials({ limit: 50 })
        setExternalMaterials(raw_materials)
      } catch (error) {
        console.error("Error fetching materials:", error)
        setMaterialsError(error instanceof Error ? error.message : "Failed to load materials")
      } finally {
        setMaterialsLoading(false)
      }
    }

    fetchMaterials()
  }, [])

  useEffect(() => {
    const fetchPartners = async () => {
      setPartnersLoading(true)
      try {
        const { partners } = await listPartners({ limit: 20 })
        setExternalPartners(partners as Partner[])
      } catch (error) {
        console.error("Error fetching partners:", error)
      } finally {
        setPartnersLoading(false)
      }
    }

    fetchPartners()
  }, [])

  return {
    selectedMaterial,
    setSelectedMaterial,
    showMaterialModal,
    setShowMaterialModal,
    externalMaterials,
    materialsLoading,
    materialsError,
    selectedPartner,
    setSelectedPartner,
    showPartnerModal,
    setShowPartnerModal,
    externalPartners,
    partnersLoading,
  }
}
