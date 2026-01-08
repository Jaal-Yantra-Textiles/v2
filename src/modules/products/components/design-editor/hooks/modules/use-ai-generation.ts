import { useCallback, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { generateAiImage, AiBadges, GenerateAiImageResponse } from "@lib/data/ai-imagegen"
import { AiGenerationHistoryItem, BadgePreferences, CustomerInfo, DesignState } from "../../types"

/**
 * Converts BadgePreferences from the UI format to API format
 */
function convertBadgesToApiFormat(badges: BadgePreferences): AiBadges {
  return {
    style: badges.style || undefined,
    color_family: badges.colorPalette.join(", ") || undefined,
    body_type: badges.bodyType || undefined,
    embellishment_level: badges.embellishment || undefined,
    occasion: badges.occasion.join(", ") || undefined,
    custom: badges.silhouette ? { silhouette: badges.silhouette } : undefined,
  }
}

// AI generation metadata stored in design state
export type AiGenerationMetadata = {
  preview_url?: string
  media_id?: string
  prompt_used: string
  generated_at: string
  quota_remaining?: number
}

// Maximum number of generation history items to keep
const MAX_HISTORY_ITEMS = 10

// Hook arguments
type UseAiGenerationArgs = {
  customer: CustomerInfo | null
  countryCode?: string
  badgePreferences: BadgePreferences
  design: DesignState
  setDesign: React.Dispatch<React.SetStateAction<DesignState>>
  persistDraftSnapshot: () => void
  onBaseImageGenerated?: (url: string) => void
  // For restoring history from draft
  initialHistory?: AiGenerationHistoryItem[]
  onHistoryChange?: (history: AiGenerationHistoryItem[]) => void
}

// Hook return type
type UseAiGenerationResult = {
  // State
  isGeneratingAi: boolean
  aiGenerationError: string | null
  showLoginPrompt: boolean
  lastAiGeneration: AiGenerationMetadata | null
  quotaRemaining: number | null
  generationHistory: AiGenerationHistoryItem[]

  // Methods
  generateAiBase: (mode?: "preview" | "commit") => Promise<void>
  dismissLoginPrompt: () => void
  handleLoginRedirect: () => void
  clearAiError: () => void
  selectFromHistory: (item: AiGenerationHistoryItem) => void
  clearHistory: () => void
}

/**
 * Hook module for AI image generation functionality
 *
 * Handles:
 * - AI generation state (loading, error, results)
 * - Authentication checking and login prompt
 * - Calling the AI imagegen API
 * - Updating design state with generated image
 */
export const useAiGeneration = ({
  customer,
  countryCode,
  badgePreferences,
  design,
  setDesign,
  persistDraftSnapshot,
  onBaseImageGenerated,
  initialHistory = [],
  onHistoryChange,
}: UseAiGenerationArgs): UseAiGenerationResult => {
  const router = useRouter()
  const pathname = usePathname()

  // AI generation state
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [aiGenerationError, setAiGenerationError] = useState<string | null>(null)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [lastAiGeneration, setLastAiGeneration] = useState<AiGenerationMetadata | null>(null)
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null)
  const [generationHistory, setGenerationHistory] = useState<AiGenerationHistoryItem[]>(initialHistory)

  /**
   * Clear AI generation error
   */
  const clearAiError = useCallback(() => {
    setAiGenerationError(null)
  }, [])

  /**
   * Dismiss login prompt without redirecting
   */
  const dismissLoginPrompt = useCallback(() => {
    setShowLoginPrompt(false)
  }, [])

  /**
   * Handle login redirect - persist draft and navigate to account
   */
  const handleLoginRedirect = useCallback(() => {
    // Persist current design state before navigating away
    persistDraftSnapshot()

    // Close the prompt
    setShowLoginPrompt(false)

    // Build login URL with redirect_to parameter to return after login
    const baseLoginPath = countryCode ? `/${countryCode}/account` : "/account"
    const redirectTo = encodeURIComponent(pathname)
    const loginPath = `${baseLoginPath}?redirect_to=${redirectTo}`

    router.push(loginPath)
  }, [countryCode, router, persistDraftSnapshot, pathname])

  /**
   * Generate AI base image
   *
   * @param mode - "preview" for temporary image, "commit" for permanent storage
   */
  const generateAiBase = useCallback(async (mode: "preview" | "commit" = "preview") => {
    // Check authentication first
    if (!customer) {
      setShowLoginPrompt(true)
      return
    }

    // Clear previous errors
    setAiGenerationError(null)
    setIsGeneratingAi(true)

    try {
      // Convert badge preferences to API format
      const badges = convertBadgesToApiFormat(badgePreferences)

      // Build canvas snapshot if we have layers
      const canvasSnapshot = design.layers.length > 0 ? {
        width: 1024,
        height: 1024,
        layers: design.layers.map(layer => ({
          id: layer.id,
          type: layer.type as "image" | "text" | "shape",
          data: {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
            ...(layer.type === "text" ? { text: layer.text, fontSize: layer.fontSize } : {}),
            ...(layer.type === "image" ? { src: layer.src } : {}),
          },
        })),
      } : undefined

      // Call the AI generation API
      const response: GenerateAiImageResponse = await generateAiImage({
        mode,
        badges,
        canvas_snapshot: canvasSnapshot,
      })

      const { generation } = response

      // Store generation metadata
      const metadata: AiGenerationMetadata = {
        preview_url: generation.preview_url,
        media_id: generation.media_id,
        prompt_used: generation.prompt_used,
        generated_at: generation.generated_at,
        quota_remaining: generation.quota_remaining,
      }

      setLastAiGeneration(metadata)

      // Update quota display
      if (generation.quota_remaining !== undefined) {
        setQuotaRemaining(generation.quota_remaining)
      }

      // Add to generation history if we have a preview URL
      if (generation.preview_url) {
        const historyItem: AiGenerationHistoryItem = {
          id: `gen-${Date.now()}`,
          preview_url: generation.preview_url,
          prompt_used: generation.prompt_used,
          generated_at: generation.generated_at,
          badges: { ...badgePreferences },
        }

        setGenerationHistory(prev => {
          const newHistory = [historyItem, ...prev].slice(0, MAX_HISTORY_ITEMS)
          // Notify parent of history change for persistence
          onHistoryChange?.(newHistory)
          return newHistory
        })
      }

      // If we got an image URL, notify parent to update the canvas
      if (generation.preview_url && onBaseImageGenerated) {
        onBaseImageGenerated(generation.preview_url)
      }

      // Store AI generation info in design metadata
      setDesign(prev => ({
        ...prev,
        // Note: The actual base image update happens via onBaseImageGenerated callback
        // This just stores the AI metadata for reference
      }))

    } catch (error: any) {
      console.error("[AI Generation] Error:", error)

      // Handle specific error types
      if (error?.message === "AUTH_REQUIRED") {
        setShowLoginPrompt(true)
        setAiGenerationError(null)
      } else if (error?.message === "QUOTA_EXCEEDED") {
        setAiGenerationError("You've reached your daily AI generation limit. Try again tomorrow.")
        setQuotaRemaining(0)
      } else {
        setAiGenerationError(
          error?.message || "Failed to generate AI image. Please try again."
        )
      }
    } finally {
      setIsGeneratingAi(false)
    }
  }, [customer, badgePreferences, design.layers, onBaseImageGenerated, setDesign, onHistoryChange])

  /**
   * Select a previous generation from history and apply it as the base image
   */
  const selectFromHistory = useCallback((item: AiGenerationHistoryItem) => {
    if (item.preview_url && onBaseImageGenerated) {
      onBaseImageGenerated(item.preview_url)
    }
  }, [onBaseImageGenerated])

  /**
   * Clear all generation history
   */
  const clearHistory = useCallback(() => {
    setGenerationHistory([])
    onHistoryChange?.([])
  }, [onHistoryChange])

  return {
    // State
    isGeneratingAi,
    aiGenerationError,
    showLoginPrompt,
    lastAiGeneration,
    quotaRemaining,
    generationHistory,

    // Methods
    generateAiBase,
    dismissLoginPrompt,
    handleLoginRedirect,
    clearAiError,
    selectFromHistory,
    clearHistory,
  }
}
