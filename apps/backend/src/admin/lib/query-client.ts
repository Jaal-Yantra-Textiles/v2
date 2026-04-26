import { QueryClient } from "@tanstack/react-query";

// @ts-ignore
// Vite uses import.meta.env instead of process.env for environment variables
// Variables must be prefixed with VITE_ to be exposed to the client
// @ts-ignore
export const MEDUSA_BACKEND_URL = import.meta.env.VITE_MEDUSA_BACKEND_URL || "/";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 90000,
      retry: 1,
    },
  },
});
