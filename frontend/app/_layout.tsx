import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, StyleSheet, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/queries/queryClient';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { PriceAlertPopup } from '../src/components/PriceAlertPopup';
import { WalletAlertPopup } from '../src/components/WalletAlertPopup';
import { OnboardingTutorial } from '../src/components/OnboardingTutorial';
import { ToastHost } from '../src/components/ToastHost';
import { useLanguageStore, useTranslation } from '../src/i18n';
import { useModulesStore } from '../src/stores/modulesStore';
import { useScanQueueStore } from '../src/stores/scanQueueStore';
import NetInfo from '@react-native-community/netinfo';
import { Toast } from '../src/utils/toast';
import { COLORS } from '../src/theme/colors';

// Single source of truth for auth-based navigation. Screens (login.tsx,
// the tabs layout) used to each run their own redirect effect; two
// independent effects both reacting to the same isAuthenticated flip
// re-triggered each other into an infinite render loop on logout.
//
// login.tsx lives at "/login", not "/", so it never competes with
// (tabs)/index.tsx for the root path - replace("/") used to silently
// resolve back to whichever of the two the router already considered
// "current" instead of actually leaving the tabs group.
//
// "login" and "forgot-password" are public because they're only ever
// needed logged out. privacy-policy/terms-of-service are public for a
// different reason: login.tsx links to both, and without this, tapping
// either from a logged-out login screen (or visiting its URL directly on
// the web build - e.g. the link Google Play/App Store review requires in
// the console) bounced straight back to /login before the text ever
// rendered. Every other top-level route (e.g. company-settings,
// users-management, budget) is pushed on top of the tabs stack and still
// requires auth, so redirecting whenever the user isn't literally inside
// "(tabs)" would bounce them back out of those screens the instant they
// navigate to one.
const PUBLIC_SCREENS = ['login', 'forgot-password', 'privacy-policy', 'terms-of-service'];

function useProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const onLoginScreen = segments[0] === 'login';
    const onPublicScreen = PUBLIC_SCREENS.includes(segments[0] as string);
    if (isAuthenticated && onLoginScreen) {
      router.replace('/(tabs)');
    } else if (!isAuthenticated && !onPublicScreen) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, segments]);
}

function AppShell() {
  useProtectedRoute();

  // Restores the saved language preference once per app boot - previously
  // only login.tsx's mount effect did this, so a logged-in user landing
  // directly on any other route (a refresh, a deep link, a resumed native
  // session) never saw it restored and silently fell back to Bulgarian.
  const loadLanguage = useLanguageStore((state) => state.loadLanguage);
  useEffect(() => {
    loadLanguage();
  }, [loadLanguage]);

  // What this business uses - the menus, Home and the tabs follow it; again
  // whenever the person moves to another company.
  const { user, isAuthenticated } = useAuth();
  const loadModules = useModulesStore((state) => state.load);
  const companyId = isAuthenticated ? user?.company_id ?? null : null;
  useEffect(() => {
    loadModules(companyId);
  }, [companyId, loadModules]);

  return (
    <>
      <StatusBar style="light" />
      <View style={styles.container}>
        <OfflineBanner />
        <PriceAlertPopup />
        <WalletAlertPopup />
        <OnboardingTutorial />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: COLORS.background },
            animation: 'slide_from_right',
          }}
        />
        <ToastHost />
        <ScanQueueProcessor companyId={companyId} />
      </View>
    </>
  );
}

// Scans taken without a connection (Н12) are read on their own once it
// is back - wherever the person is in the app - and wait on the scan
// screen to be reviewed.
function ScanQueueProcessor({ companyId }: { companyId: string | null }) {
  const { t } = useTranslation();
  const processPending = useScanQueueStore((state) => state.processPending);
  useEffect(() => {
    if (!companyId) return undefined;
    const run = async () => {
      const ready = await processPending(companyId);
      if (ready > 0) Toast.success(t('scanQueue.readyToast').replace('{count}', String(ready)));
    };
    run();
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) run();
    });
    // Not every reconnection is told (a browser, some phones): while photos
    // wait, try again every half minute, and whenever the app comes back.
    const timer = setInterval(() => {
      const waiting = useScanQueueStore.getState().items
        .some((item) => item.status === 'waiting' && item.companyId === companyId);
      if (waiting) run();
    }, 30 * 1000);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') run();
    });
    return () => {
      unsubscribe();
      clearInterval(timer);
      appState.remove();
    };
  }, [companyId, processPending, t]);
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
