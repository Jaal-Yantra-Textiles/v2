import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { sdk } from "@/lib/medusa"
import type { HttpTypes } from "@medusajs/types"

type RegionContextType = {
  region: HttpTypes.StoreRegion | null
  regions: HttpTypes.StoreRegion[] | null
  setRegion: (region: HttpTypes.StoreRegion) => void
  isLoading: boolean
}

const RegionContext = createContext<RegionContextType | null>(null)

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [region, setRegionState] = useState<HttpTypes.StoreRegion | null>(null)
  const [regions, setRegions] = useState<HttpTypes.StoreRegion[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchRegions = async () => {
      try {
        const { regions: fetchedRegions } = await sdk.store.region.list()
        setRegions(fetchedRegions || [])

        // Set default region (first one or based on env var)
        const defaultRegionCode = process.env.EXPO_PUBLIC_DEFAULT_REGION || "us"
        const defaultRegion =
          fetchedRegions?.find((r) =>
            r.countries?.some((c) => c.iso_2?.toLowerCase() === defaultRegionCode)
          ) || fetchedRegions?.[0]

        if (defaultRegion) {
          setRegionState(defaultRegion)
        }
      } catch (error) {
        console.error("Failed to fetch regions:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchRegions()
  }, [])

  const setRegion = useCallback((newRegion: HttpTypes.StoreRegion) => {
    setRegionState(newRegion)
  }, [])

  return (
    <RegionContext.Provider value={{ region, regions, setRegion, isLoading }}>
      {children}
    </RegionContext.Provider>
  )
}

export function useRegion() {
  const context = useContext(RegionContext)
  if (!context) {
    throw new Error("useRegion must be used within a RegionProvider")
  }
  return context
}
