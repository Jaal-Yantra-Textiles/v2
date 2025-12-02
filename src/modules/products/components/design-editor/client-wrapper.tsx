"use client"

import dynamic from "next/dynamic"
import type { DesignProduct } from "./index"

// Dynamic import to avoid SSR issues with Konva
const DesignEditor = dynamic(() => import("./index"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-500" />
    </div>
  ),
})

export default function DesignEditorWrapper({ product }: { product: DesignProduct }) {
  return <DesignEditor product={product} />
}
