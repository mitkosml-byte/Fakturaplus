import { QueryClient } from '@tanstack/react-query';

// Module 1 audit finding #5: cross-screen entities (scan-credit balance,
// price-alert unread count, ...) were each refetched independently per
// screen with no shared cache - two components mounted at once (e.g. the
// Home and Invoices tab headers both rendering ScanCreditsBadge) issued
// two separate network calls for the exact same data. One shared
// QueryClient, provided once at the app root, dedupes concurrent fetches
// for the same query key and lets a screen read data another screen just
// fetched instead of re-requesting it.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // These entities change slowly enough (a scan balance only moves on
      // scan/purchase, price alerts on a new invoice) that refetching more
      // than once every 30s per key is pure waste, not freshness.
      staleTime: 30_000,
      retry: 1,
    },
  },
});
