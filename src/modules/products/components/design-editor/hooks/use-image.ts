"use client"

import { useEffect, useState } from "react"

export function useImage(src?: string | null): [HTMLImageElement | null, "loading" | "loaded" | "error"] {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")

  useEffect(() => {
    if (!src) {
      setImage(null)
      setStatus("error")
      return
    }

    // Set loading state BEFORE assigning src. Browser-cached images fire onload
    // synchronously during `img.src = src`, so if setStatus("loading") comes after,
    // it overwrites the "loaded" state and the image appears permanently stuck loading.
    setStatus("loading")

    const img = new window.Image()
    img.crossOrigin = "anonymous"

    img.onload = () => {
      setImage(img)
      setStatus("loaded")
    }

    img.onerror = () => {
      setImage(null)
      setStatus("error")
    }

    img.src = src

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])

  return [image, status]
}
