import { useState, useCallback } from "react"
import { useMotionValue } from "framer-motion"

export const useExpandable = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const animatedHeight = useMotionValue(0)

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  return { isExpanded, toggleExpand, animatedHeight }
}
