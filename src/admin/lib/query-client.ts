import { QueryClient } from "@tanstack/react-query";

export const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "/";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 90000,
      retry: 1,
    },
  },
});
