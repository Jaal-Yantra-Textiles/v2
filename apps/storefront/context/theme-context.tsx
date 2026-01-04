import React, { createContext, useContext, useState } from "react"
import { useColorScheme as useSystemColorScheme } from "react-native"
import { Colors, ColorScheme, ThemeColors } from "@/constants/theme"

type ThemeMode = "light" | "dark" | "system"

type ThemeContextType = {
  mode: ThemeMode
  colorScheme: ColorScheme
  colors: ThemeColors
  setMode: (mode: ThemeMode) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useSystemColorScheme()
  const [mode, setMode] = useState<ThemeMode>("system")

  const colorScheme: ColorScheme =
    mode === "system" ? (systemColorScheme ?? "light") : mode

  const colors = Colors[colorScheme]
  const isDark = colorScheme === "dark"

  return (
    <ThemeContext.Provider
      value={{
        mode,
        colorScheme,
        colors,
        setMode,
        isDark,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
