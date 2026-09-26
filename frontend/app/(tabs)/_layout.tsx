import React, { useCallback, useRef } from 'react';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, StyleSheet, useWindowDimensions, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../src/i18n';

// Left-to-right order of the tab bar, used to resolve which tab a swipe
// should land on and to know a swipe's direction relative to it.
const TAB_ROUTES = ['/', '/scan', '/invoices', '/stats', '/profile'];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();

  // PanResponder below is created once via useRef so its handlers don't
  // reattach on every render; goToTab must therefore read the *current*
  // route from a ref rather than close over the `pathname` value from
  // whichever render first built the responder, or every swipe after
  // the first navigation would still act as if we were on the initial tab.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const goToTab = useCallback(
    (delta: number) => {
      const currentIndex = TAB_ROUTES.indexOf(pathnameRef.current);
      if (currentIndex === -1) return;
      const nextIndex = currentIndex + delta;
      if (nextIndex < 0 || nextIndex >= TAB_ROUTES.length) return;
      router.navigate(TAB_ROUTES[nextIndex] as any);
    },
    [router]
  );

  // Plain React Native PanResponder rather than react-native-gesture-handler:
  // GestureDetector wraps its child in a "display: contents" div on web,
  // which browsers always report as a zero-size bounding rect, so its
  // pointer-in-bounds check rejects every touch there - it silently never
  // fires on the web build (what actually runs on the phone here, since
  // the frontend ships as a static site opened in the mobile browser).
  // PanResponder doesn't have that problem and works the same on native.
  //
  // onMoveShouldSetPanResponder only claims the gesture once a move is
  // clearly more horizontal than vertical and past a small threshold, so
  // vertical scrolling inside a tab (invoice list, stats charts, ...) is
  // left alone, and a plain tap never claims anything - it falls through
  // untouched to the tab bar buttons and on-screen controls.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        return Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx < -60) {
          goToTab(1);
        } else if (gesture.dx > 60) {
          goToTab(-1);
        }
      },
    })
  ).current;

  return (
    <View style={styles.flex} {...panResponder.panHandlers}>
      <Tabs
        screenOptions={{
          headerShown: false,
          animation: 'shift',
          sceneStyleInterpolator: ({ current }) => ({
            sceneStyle: {
              transform: [
                {
                  translateX: current.progress.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [-width, 0, width],
                  }),
                },
              ],
            },
          }),
          tabBarStyle: {
            backgroundColor: '#1E293B',
            borderTopColor: '#334155',
            borderTopWidth: 1,
            height: 70 + Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0),
            paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0),
            paddingTop: 8,
          },
          tabBarActiveTintColor: '#8B5CF6',
          tabBarInactiveTintColor: '#64748B',
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('nav.home'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="scan"
          options={{
            title: t('nav.scan'),
            tabBarIcon: ({ color, size }) => (
              <View style={styles.scanButton}>
                <Ionicons name="scan" size={28} color="white" />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="invoices"
          options={{
            title: t('nav.invoices'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="document-text" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="stats"
          options={{
            title: t('nav.stats'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="stats-chart" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('nav.profile'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person" size={24} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scanButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
