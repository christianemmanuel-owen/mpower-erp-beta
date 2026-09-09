import { QueryClient } from '@tanstack/react-query'

/** Module-level singleton so non-React code (the repos) can invalidate caches. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Other people's edits show up without a manual refresh.
      refetchInterval: 20_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})
