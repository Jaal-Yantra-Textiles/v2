import { useQuery } from "@tanstack/react-query"

export type FeatureFlags = {
  view_configurations?: boolean
  translation?: boolean
  rbac?: boolean
  [key: string]: boolean | undefined
}

// Investor UI is NOT an admin actor. The inherited dashboard hook fetched
// /admin/feature-flags, which CORS-fails from the portal origin (invest.*) and,
// worse, an admin 401 would clear the shared JWT. The portal uses none of these
// admin-only flags (rbac / view_configurations / translation), so resolve them
// statically (all off) with no network call — mirrors the other stubbed admin
// hooks (invites / store / rbac-roles).
export const useFeatureFlags = () => {
  return useQuery<FeatureFlags>({
    queryKey: ["investor", "feature-flags"],
    queryFn: async () => ({}),
    staleTime: Infinity,
  })
}
