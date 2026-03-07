"use client"

import React, { useState, useRef, useEffect } from "react"
import { XMark, Sparkles } from "@medusajs/icons"
import { CustomerInfo } from "../types"
import { generateTryOn } from "@lib/data/ai-tryon"
import type Konva from "konva"

type TryOnModalProps = {
  isOpen: boolean
  onClose: () => void
  stageRef: React.RefObject<Konva.Stage | null>
  customer?: CustomerInfo | null
  productImages?: string[]
  onPaymentRequired?: () => void
}

type ClothType = "upper_body" | "lower_body" | "dress"
type Gender = "female" | "male"

const CLOTH_TYPE_OPTIONS: { value: ClothType; label: string }[] = [
  { value: "upper_body", label: "Upper Body" },
  { value: "lower_body", label: "Lower Body" },
  { value: "dress", label: "Full Dress" },
]

export function TryOnModal({
  isOpen,
  onClose,
  stageRef,
  customer,
  productImages,
  onPaymentRequired,
}: TryOnModalProps) {
  const [faceBlob, setFaceBlob] = useState<Blob | null>(null)
  const [facePreview, setFacePreview] = useState<string | null>(null)
  const [faceSavedFromStorage, setFaceSavedFromStorage] = useState(false)
  const [clothType, setClothType] = useState<ClothType>("upper_body")
  const [gender, setGender] = useState<Gender>("female")
  const [selectedGarmentUrl, setSelectedGarmentUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const storageKey = customer ? `_jyt_face_${customer.id}` : null

  // On mount: restore saved face from localStorage
  useEffect(() => {
    if (!storageKey || !isOpen) return
    const saved = localStorage.getItem(storageKey)
    if (saved && !faceBlob) {
      setFacePreview(saved)
      setFaceSavedFromStorage(true)
      // Convert data URL back to blob
      fetch(saved)
        .then(r => r.blob())
        .then(blob => setFaceBlob(blob))
        .catch(() => {})
    }
  }, [isOpen, storageKey])

  if (!isOpen) return null

  const handleClose = () => {
    setFaceBlob(null)
    setFacePreview(null)
    setFaceSavedFromStorage(false)
    setClothType("upper_body")
    setGender("female")
    setSelectedGarmentUrl(null)
    setIsLoading(false)
    setResultUrl(null)
    setError(null)
    onClose()
  }

  const handleFaceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFaceBlob(file)
    setResultUrl(null)
    setError(null)
    setFaceSavedFromStorage(false)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setFacePreview(dataUrl)
      if (storageKey) {
        try { localStorage.setItem(storageKey, dataUrl) } catch {}
      }
    }
    reader.readAsDataURL(file)
  }

  const handleClearSavedFace = () => {
    if (storageKey) localStorage.removeItem(storageKey)
    setFaceBlob(null)
    setFacePreview(null)
    setFaceSavedFromStorage(false)
  }

  const handleGenerate = async () => {
    if (!faceBlob) return
    setIsLoading(true)
    setError(null)
    setResultUrl(null)

    try {
      let garmentPayload: { garmentFile?: Blob; garmentUrl?: string }

      if (selectedGarmentUrl) {
        garmentPayload = { garmentUrl: selectedGarmentUrl }
      } else {
        if (!stageRef.current) throw new Error("Canvas not ready")
        const garmentBlob = (await stageRef.current.toBlob({ pixelRatio: 1.5 })) as Blob | null
        if (!garmentBlob) throw new Error("Canvas export failed")
        garmentPayload = { garmentFile: garmentBlob }
      }

      const response = await generateTryOn({
        ...garmentPayload,
        faceFile: faceBlob,
        cloth_type: clothType,
        gender,
      })

      if (response.error) {
        if (response.error.code === "PAYMENT_REQUIRED") {
          onPaymentRequired?.()
          handleClose()
        } else {
          setError(response.error.message)
        }
      } else if (response.tryon?.result_url) {
        setResultUrl(response.tryon.result_url)
      } else {
        setError("No result returned. Please try again.")
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const hasProductImages = productImages && productImages.length > 0
  const canGenerate = !!faceBlob && !isLoading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100">
              <Sparkles className="text-violet-600" />
            </div>
            <span className="text-base font-semibold text-gray-900">Virtual Try-On</span>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <XMark />
          </button>
        </div>

        {/* Not logged in */}
        {!customer ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <p className="text-sm text-gray-600">
              Sign in to use Virtual Try-On and see yourself wearing this design.
            </p>
            <button
              onClick={() => {
                const returnTo = encodeURIComponent(
                  window.location.pathname + window.location.search +
                  (window.location.search ? "&tryon=1" : "?tryon=1")
                )
                window.location.href = `/account?redirect_to=${returnTo}`
              }}
              className="rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
            >
              Sign In to Try On
            </button>
            <button
              onClick={handleClose}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Garment selection */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Garment
              </label>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {/* "Use my design" option */}
                <button
                  onClick={() => setSelectedGarmentUrl(null)}
                  className={`flex-shrink-0 relative h-16 w-16 rounded-xl border-2 flex items-center justify-center text-center transition-colors ${
                    selectedGarmentUrl === null
                      ? "border-violet-500 bg-violet-50"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  {selectedGarmentUrl === null && (
                    <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white text-[8px] font-bold">
                      ✓
                    </span>
                  )}
                  <span className="text-[9px] font-medium text-slate-600 leading-tight px-1">
                    My design
                  </span>
                </button>

                {/* Product images */}
                {hasProductImages && productImages.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedGarmentUrl(url)}
                    className={`flex-shrink-0 relative h-16 w-16 rounded-xl border-2 overflow-hidden transition-colors ${
                      selectedGarmentUrl === url
                        ? "border-violet-500"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {selectedGarmentUrl === url && (
                      <span className="absolute top-0.5 right-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white text-[8px] font-bold">
                        ✓
                      </span>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Product image ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Face photo upload */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Your Photo
              </label>
              <div className="flex items-center gap-3">
                {facePreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={facePreview}
                    alt="Face preview"
                    className="h-16 w-16 rounded-xl object-cover border border-gray-200 flex-shrink-0"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center flex-shrink-0 bg-gray-50">
                    <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    {faceBlob ? "Change photo" : "Upload photo"}
                  </button>
                  {faceSavedFromStorage ? (
                    <button
                      onClick={handleClearSavedFace}
                      className="text-[10px] text-gray-400 hover:text-red-500 transition-colors text-left"
                    >
                      Clear saved photo
                    </button>
                  ) : (
                    <p className="text-[10px] text-gray-400">Clear face photo works best</p>
                  )}
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFaceFileChange}
              />
            </div>

            {/* Cloth type */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Garment Type
              </label>
              <div className="flex gap-2">
                {CLOTH_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setClothType(opt.value)}
                    className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      clothType === opt.value
                        ? "border-violet-500 bg-violet-50 text-violet-700"
                        : "border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Gender */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Gender
              </label>
              <div className="flex gap-2">
                {(["female", "male"] as Gender[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      gender === g
                        ? "border-violet-500 bg-violet-50 text-violet-700"
                        : "border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-200">
                {error}
              </p>
            )}

            {/* Loading hint */}
            {isLoading && (
              <p className="text-xs text-gray-400 text-center">
                This takes ~20 seconds…
              </p>
            )}

            {/* Result */}
            {resultUrl && (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultUrl}
                  alt="Try-on result"
                  className="w-full rounded-2xl object-cover border border-gray-200"
                />
                <a
                  href={resultUrl}
                  download="try-on-result.jpg"
                  className="flex items-center justify-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Download
                </a>
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                !canGenerate
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow hover:from-violet-700 hover:to-blue-700"
              }`}
            >
              {isLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Try-On
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
