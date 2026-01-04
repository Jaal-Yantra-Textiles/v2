import { useTheme } from "@/context/theme-context"

export function useColorScheme() {
  return useTheme().colorScheme
}
