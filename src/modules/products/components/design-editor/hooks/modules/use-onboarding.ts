import { useCallback, useEffect, useMemo, useState } from "react"

const ONBOARDING_STORAGE_KEY = "design-editor-onboarding-dismissed"

type OnboardingStep = {
  title: string
  description: string
}

type UseOnboardingStateArgs = {
  isMobileLayout: boolean
}

type UseOnboardingStateResult = {
  sidebarExpanded: boolean
  setSidebarExpanded: React.Dispatch<React.SetStateAction<boolean>>
  showOnboarding: boolean
  onboardingSteps: OnboardingStep[]
  onboardingStep: number
  handleNextStep: () => void
  handlePrevStep: () => void
  handleSkipOnboarding: () => void
}

export const useOnboardingState = ({
  isMobileLayout,
}: UseOnboardingStateArgs): UseOnboardingStateResult => {
  const [sidebarExpanded, setSidebarExpanded] = useState(!isMobileLayout)
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [onboardingStep, setOnboardingStep] = useState(0)

  useEffect(() => {
    if (isMobileLayout) {
      setSidebarExpanded(false)
    } else {
      setSidebarExpanded(true)
    }
  }, [isMobileLayout])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const hasDismissed = window.localStorage.getItem(ONBOARDING_STORAGE_KEY)
    if (hasDismissed === "true") {
      setShowOnboarding(false)
    }
  }, [])

  const onboardingSteps = useMemo<OnboardingStep[]>(
    () => [
      {
        title: "Choose your base",
        description: "Start with a silhouette from our ready-to-tailor collection to anchor your idea.",
      },
      {
        title: "Select handloom fabrics",
        description: "Browse our in-house materials sourced across India and match colors to your story.",
      },
      {
        title: "Assign a production partner",
        description: "Pick an artisan workshop from our global partner list to bring the piece to life.",
      },
    ],
    []
  )

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false)

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true")
      } catch (error) {
        console.warn("Unable to persist onboarding dismissal", error)
      }
    }
  }, [])

  const handleNextStep = useCallback(() => {
    if (onboardingStep < onboardingSteps.length - 1) {
      setOnboardingStep((prev) => prev + 1)
    } else {
      dismissOnboarding()
    }
  }, [dismissOnboarding, onboardingStep, onboardingSteps.length])

  const handlePrevStep = useCallback(() => {
    setOnboardingStep((prev) => Math.max(prev - 1, 0))
  }, [])

  const handleSkipOnboarding = useCallback(() => {
    dismissOnboarding()
  }, [dismissOnboarding])

  return {
    sidebarExpanded,
    setSidebarExpanded,
    showOnboarding,
    onboardingSteps,
    onboardingStep,
    handleNextStep,
    handlePrevStep,
    handleSkipOnboarding,
  }
}
