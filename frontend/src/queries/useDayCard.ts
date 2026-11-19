import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

// The day card for whoever lands on Team (no access to Home, which brings
// the card in its own one request). The card changes a few times a day at
// most - the weather every couple of hours - so ten minutes is fresh enough.
export function useDayCard(language: string, enabled: boolean) {
  return useQuery({
    queryKey: ['dayCard', language],
    queryFn: () => api.getDayCard(language),
    enabled,
    staleTime: 10 * 60_000,
  });
}
