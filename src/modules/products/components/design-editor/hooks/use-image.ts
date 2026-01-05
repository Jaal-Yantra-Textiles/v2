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

    const img = new window.Image()

    img.onload = () => {
      setImage(img)
      setStatus("loaded")
    }

    img.onerror = () => {
      setImage(null)
      setStatus("error")
    }

    img.src = src
    setStatus("loading")

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])

  return [image, status]
}
