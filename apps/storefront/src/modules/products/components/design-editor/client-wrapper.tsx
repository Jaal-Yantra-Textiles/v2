"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { CustomerInfo, DesignProduct } from "./types"
import { DesignDetail } from "@lib/data/designs"
import { retrieveCustomerFresh } from "@lib/data/customer"

// Dynamic import to avoid SSR issues with Konva
const DesignEditor = dynamic(() => import("./index"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-500" />
    </div>
  ),
})

interface DesignEditorWrapperProps {
  product: DesignProduct
  customer?: CustomerInfo | null
  countryCode?: string
  initialDesign?: DesignDetail | null
}

export default function DesignEditorWrapper({
  product,
  customer: initialCustomer,
  countryCode,
  initialDesign,
}: DesignEditorWrapperProps) {
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  // Use a fresh server-side fetch on mount to get accurate auth state,
  // bypassing any stale Next.js force-cache from the page's retrieveCustomer().
  const [customer, setCustomer] = useState<CustomerInfo | null>(initialCustomer ?? null)

  useEffect(() => {
    const handleResize = () => {
      setIsMobileLayout(window.innerWidth < 1024)
    }

    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // On mount, do a fresh no-cache customer fetch to ensure auth state is current.
  // This handles the case where the page-level retrieveCustomer() returned null
  // due to a stale force-cache response while the user is actually logged in.
  useEffect(() => {
    retrieveCustomerFresh().then((freshCustomer) => {
      if (freshCustomer) {
        setCustomer({
          id: freshCustomer.id,
          email: freshCustomer.email,
          aiFeaturesPaid: freshCustomer.metadata?.ai_features_paid === true,
        })
      } else if (initialCustomer === null) {
        // Confirmed not logged in
        setCustomer(null)
      }
    })
  }, [])

  return (
    <DesignEditor
      product={product}
      customer={customer}
      countryCode={countryCode}
      isMobileLayout={isMobileLayout}
      initialDesign={initialDesign}
    />
  )
}
