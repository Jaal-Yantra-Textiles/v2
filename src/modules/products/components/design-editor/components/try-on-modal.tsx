"use client"

import React, { useState, useRef } from "react"
import { XMark, Sparkles } from "@medusajs/icons"
import { CustomerInfo } from "../types"
import { generateTryOn } from "@lib/data/ai-tryon"
import type Konva from "konva"

type TryOnModalProps = {
  isOpen: boolean
  onClose: () => void
  stageRef: React.RefObject<Konva.Stage | null>
  customer?: CustomerInfo | null
}

type ClothType = "upper_body" | "lower_body" | "dress"
type Gender = "female" | "male"

const CLOTH_TYPE_OPTIONS: { value: ClothType; label: string }[] = [
  { value: "upper_body", label: "Upper Body" },
  { value: "lower_body", label: "Lower Body" },
  { value: "dress", label: "Full Dress" },
]

export function TryOnModal({ isOpen, onClose, stageRef, customer }: TryOnModalProps) {
  const [faceFile, setFaceFile] = useState<File | null>(null)
  const [facePreview, setFacePreview] = useState<string | null>(null)
  const [clothType, setClothType] = useState<ClothType>("upper_body")
  const [gender, setGender] = useState<Gender>("female")
  const [isLoading, setIsLoading] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const handleClose = () => {
    setFaceFile(null)
    setFacePreview(null)
    setClothType("upper_body")
    setGender("female")
    setIsLoading(false)
    setResultUrl(null)
    setError(null)
    onClose()
  }

  const handleFaceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFaceFile(file)
    setResultUrl(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = (ev) => setFacePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleGenerate = async () => {
    if (!faceFile || !stageRef.current) return
    setIsLoading(true)
    setError(null)
    setResultUrl(null)

    try {
      // Convert Konva canvas to a Blob (multipart-friendly, no base64 inflation)
      const garmentBlob = await stageRef.current.toBlob({ pixelRatio: 1.5 })
      if (!garmentBlob) throw new Error("Canvas export failed")

      const response = await generateTryOn({
        garmentFile: garmentBlob,
        faceFile,
        cloth_type: clothType,
        gender,
      })

      if (response.error) {
        setError(response.error.message)
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-xl">
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
              onClick={handleClose}
              className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Face photo upload */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Your Photo
              </label>
              <div className="flex items-center gap-3">
                {facePreview ? (
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
                    {faceFile ? "Change photo" : "Upload photo"}
                  </button>
                  <p className="text-[10px] text-gray-400">Clear face photo works best</p>
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
              disabled={!faceFile || isLoading}
              className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                !faceFile || isLoading
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
