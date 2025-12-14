import { default as debounceFn } from "lodash.debounce"
import { useCallback, useContext, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { useLogout } from "../../hooks/api/auth"
import { queryClient } from "../../lib/query-client"
import { KeybindContext } from "./keybind-context"
import { Shortcut } from "./types"
import { findShortcut } from "./utils"

export const useKeybind = () => {
  const context = useContext(KeybindContext)

  if (!context) {
    throw new Error("useKeybind must be used within a KeybindProvider")
  }

  return context
}

export const useRegisterShortcut = () => {}

export const useShortcuts = ({
  shortcuts = [],
  debounce,
}: {
  shortcuts?: Shortcut[]
  debounce: number
}) => {
  const [keys, setKeys] = useState<string[]>([])
  const navigate = useNavigate()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const removeKeys = useCallback(
    debounceFn(() => setKeys([]), debounce),
    []
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invokeShortcut = useCallback(
    debounceFn((shortcut: Shortcut | null) => {
      if (shortcut && shortcut.callback) {
        shortcut.callback()
        setKeys([])

        return
      }

      if (shortcut && shortcut.to) {
        navigate(shortcut.to)
        setKeys([])

        return
      }
    }, debounce / 2),
    []
  )

  useEffect(() => {
    if (keys.length > 0 && shortcuts.length > 0) {
      const shortcut = findShortcut(shortcuts, keys)
      invokeShortcut(shortcut)
    }

    return () => invokeShortcut.cancel()
  }, [keys, shortcuts, invokeShortcut])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement

      /**
       * Ignore key events from input, textarea and contenteditable elements
       */
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true"
      ) {
        removeKeys()
        return
      }

      setKeys((oldKeys) => [...oldKeys, event.key])
      removeKeys()
    }

    window.addEventListener("keydown", listener)

    return () => {
      window.removeEventListener("keydown", listener)
    }
  }, [removeKeys])
}

export const useGlobalShortcuts = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { mutateAsync } = useLogout()

  const handleLogout = async () => {
    await mutateAsync(undefined, {
      onSuccess: () => {
        queryClient.clear()
        navigate("/login")
      },
    })
  }

  const globalShortcuts: Shortcut[] = [
    // Pages
    {
      keys: {
        Mac: ["G", "O"],
      },
      label: "Go to Home",
      type: "pageShortcut",
      to: "/",
    },
    {
      keys: {
        Mac: ["G", "P"],
      },
      label: "Go to Designs",
      type: "pageShortcut",
      to: "/designs",
    },
    {
      keys: {
        Mac: ["G", "U"],
      },
      label: t("profile.domain"),
      type: "pageShortcut",
      to: "/settings/profile",
    },
    {
      keys: {
        Mac: ["G", "I"],
      },
      label: "Inventory Orders",
      type: "pageShortcut",
      to: "/inventory-orders",
    },
    {
      keys: {
        Mac: ["G", "T"],
      },
      label: "Tasks",
      type: "pageShortcut",
      to: "/tasks",
    },
    // Settings
    {
      keys: {
        Mac: ["G", ","],
      },
      label: "Go to Settings",
      type: "settingShortcut",
      to: "/settings",
    },
    // Commands
    {
      keys: {
        Mac: ["B", "Y", "E"],
      },
      label: t("actions.logout"),
      type: "commandShortcut",
      callback: () => handleLogout(),
    },
  ]

  return globalShortcuts
}
