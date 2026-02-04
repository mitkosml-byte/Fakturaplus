import { useState, useEffect, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

interface NetworkState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export function useNetwork() {
  const [networkState, setNetworkState] = useState<NetworkState>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setNetworkState({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      });
    });

    // Get initial state
    NetInfo.fetch().then((state) => {
      setNetworkState({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      });
    });

    return () => unsubscribe();
  }, []);

  return {
    isOnline: networkState.isConnected && networkState.isInternetReachable !== false,
    isOffline: networkState.isConnected === false || networkState.isInternetReachable === false,
    ...networkState,
  };
}

// Error handler utility
export function handleApiError(error: any, language: string = 'bg'): string {
  // Network errors
  if (error.message?.includes('Network request failed') || error.message?.includes('fetch')) {
    return language === 'bg' 
      ? 'Няма връзка с интернет. Моля, проверете връзката си.'
      : 'No internet connection. Please check your connection.';
  }

  // Server errors
  if (error.status >= 500) {
    return language === 'bg'
      ? 'Сървърът е временно недостъпен. Моля, опитайте по-късно.'
      : 'Server is temporarily unavailable. Please try again later.';
  }

  // Known API errors (already translated)
  if (error.message && !error.message.includes('Error') && !error.message.includes('error')) {
    return error.message;
  }

  // Default error
  return language === 'bg'
    ? 'Възникна грешка. Моля, опитайте отново.'
    : 'An error occurred. Please try again.';
}
