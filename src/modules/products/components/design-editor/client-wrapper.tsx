"use client"

import dynamic from "next/dynamic"
import type { DesignProduct, CustomerInfo } from "./index"

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
}

export default function DesignEditorWrapper({ 
  product, 
  customer, 
  countryCode 
}: DesignEditorWrapperProps) {
  return (
    <DesignEditor 
      product={product} 
      customer={customer} 
      countryCode={countryCode}
    />
  )
}
