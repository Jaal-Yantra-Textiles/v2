import { useQuery } from "@tanstack/react-query"

export type FeatureFlags = {
  view_configurations?: boolean
  translation?: boolean
  [key: string]: boolean | undefined
}

export const useFeatureFlags = () => {
  return useQuery<FeatureFlags>({
    queryKey: ["partner", "feature-flags"],
    queryFn: async () => {
      return {}
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })
}
