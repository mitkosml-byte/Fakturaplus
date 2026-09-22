import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View } from 'react-native';
import { OfflineBanner } from '../src/components/OfflineBanner';

// Single source of truth for auth-based navigation. Screens (login.tsx,
// the tabs layout) used to each run their own redirect effect; two
// independent effects both reacting to the same isAuthenticated flip
// re-triggered each other into an infinite render loop on logout.
//
// login.tsx lives at "/login", not "/", so it never competes with
// (tabs)/index.tsx for the root path - replace("/") used to silently
// resolve back to whichever of the two the router already considered
// "current" instead of actually leaving the tabs group.
function useProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inTabsGroup = segments[0] === '(tabs)';
    if (isAuthenticated && !inTabsGroup) {
      router.replace('/(tabs)');
    } else if (!isAuthenticated && inTabsGroup) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, segments]);
}

function AppShell() {
  useProtectedRoute();
  return (
    <>
      <StatusBar style="light" />
      <View style={styles.container}>
        <OfflineBanner />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0F172A' },
          }}
        />
      </View>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
