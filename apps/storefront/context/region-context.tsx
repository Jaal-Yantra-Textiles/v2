import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { sdk } from "@/lib/medusa"
import type { HttpTypes } from "@medusajs/types"

const REGION_STORAGE_KEY = "storefront_region_id"

function getCountryCodeFromLocale(locale: string | undefined) {
  if (!locale) return null

  const normalized = locale.replace("_", "-")
  const parts = normalized.split("-")
  const maybeCountry = parts[parts.length - 1]

  if (!maybeCountry) return null
  if (maybeCountry.length !== 2) return null

  return maybeCountry.toLowerCase()
}

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

        const savedRegionId = await AsyncStorage.getItem(REGION_STORAGE_KEY)

        const deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale
        const deviceCountryCode = getCountryCodeFromLocale(deviceLocale)

        const defaultRegionCode = process.env.EXPO_PUBLIC_DEFAULT_REGION || "us"

        const defaultRegion =
          (savedRegionId
            ? fetchedRegions?.find((r) => r.id === savedRegionId)
            : undefined) ||
          (deviceCountryCode
            ? fetchedRegions?.find((r) =>
                r.countries?.some((c) => c.iso_2?.toLowerCase() === deviceCountryCode)
              )
            : undefined) ||
          fetchedRegions?.find((r) =>
            r.countries?.some((c) => c.iso_2?.toLowerCase() === defaultRegionCode)
          ) ||
          fetchedRegions?.[0]

        if (defaultRegion) {
          if (__DEV__) {
            console.log("[Region] deviceLocale:", deviceLocale)
            console.log("[Region] derivedCountryCode:", deviceCountryCode)
            console.log("[Region] savedRegionId:", savedRegionId)
            console.log(
              "[Region] selectedRegion:",
              JSON.stringify(
                {
                  id: defaultRegion.id,
                  name: defaultRegion.name,
                  currency_code: defaultRegion.currency_code,
                  countries: (defaultRegion.countries || []).map((c) => c.iso_2),
                },
                null,
                2
              )
            )
          }
          setRegionState(defaultRegion)
          await AsyncStorage.setItem(REGION_STORAGE_KEY, defaultRegion.id)
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
    AsyncStorage.setItem(REGION_STORAGE_KEY, newRegion.id).catch(() => {})
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
