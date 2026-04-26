import { useCallback, useEffect, useRef, useState } from "react"
import { DesignState } from "../../types"

type UseDesignHistoryArgs = {
  design: DesignState
  setDesign: React.Dispatch<React.SetStateAction<DesignState>>
}

type UseDesignHistoryResult = {
  historyIndex: number
  canRedo: boolean
  recordSnapshot: (next: DesignState) => void
  undo: () => void
  redo: () => void
}

export const useDesignHistory = ({ design, setDesign }: UseDesignHistoryArgs): UseDesignHistoryResult => {
  const [history, setHistory] = useState<DesignState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyRef = useRef<DesignState[]>(history)

  useEffect(() => {
    historyRef.current = history
  }, [history])

  const recordSnapshot = useCallback(
    (next: DesignState) => {
      setHistory((prev) => {
        const truncated = prev.slice(0, historyIndex + 1)
        return [...truncated, next]
      })
      setHistoryIndex((prev) => prev + 1)
    },
    [historyIndex]
  )

  const undo = useCallback(() => {
    setHistoryIndex((prev) => {
      if (prev <= 0) {
        return prev
      }
      const newIndex = prev - 1
      const snapshot = historyRef.current[newIndex]
      if (snapshot) {
        setDesign(snapshot)
      }
      return newIndex
    })
  }, [setDesign])

  const redo = useCallback(() => {
    setHistoryIndex((prev) => {
      if (prev >= historyRef.current.length - 1) {
        return prev
      }
      const newIndex = prev + 1
      const snapshot = historyRef.current[newIndex]
      if (snapshot) {
        setDesign(snapshot)
      }
      return newIndex
    })
  }, [setDesign])

  return {
    historyIndex,
    canRedo: historyIndex < history.length - 1,
    recordSnapshot,
    undo,
    redo,
  }
}
