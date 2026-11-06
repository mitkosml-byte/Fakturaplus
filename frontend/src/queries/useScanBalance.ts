import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

// Module 1 audit finding #5's own named example of the problem this
// shared layer fixes: ScanCreditsBadge (Home/Invoices headers) and
// ScanCreditsReloadButton (Scan screen) used to each run their own
// independent `api.getScanBalance()` fetch on mount for the exact same
// number - when both are mounted at once (the normal case, since tabs
// stay mounted), that's two network round trips for one piece of data.
export const scanBalanceQueryKey = ['scanBalance'] as const;

export function useScanBalance() {
  return useQuery({
    queryKey: scanBalanceQueryKey,
    queryFn: () => api.getScanBalance(),
  });
}
