import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { useTranslation } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import { Toast } from '../../utils/toast';
import type { DayCardData, DayCardItem, WeatherKind } from '../../types';

type Props = {
  data: DayCardData | null | undefined;
  // What sits at the card's top right (Home: the scans left and help).
  right?: React.ReactNode;
  // Called once the weather's place was set from this device.
  onPlaceSet?: () => void;
};

type Part = DayCardData['greeting']['part'];

// The sky of the moment: the time of day, greyer when it rains or snows.
const SKY: Record<Part, [string, string]> = {
  morning: ['#3F3477', '#1E3A5F'],
  day: ['#1F4F82', '#14304F'],
  evening: ['#4A2A5E', '#1B1F3B'],
  night: ['#1E1B4B', '#0F172A'],
};
const WET_SKY: [string, string] = ['#334155', '#1E293B'];
const SNOW_SKY: [string, string] = ['#3E5470', '#1F2A38'];

const WEATHER_ICON: Record<WeatherKind, keyof typeof Ionicons.glyphMap> = {
  clear: 'sunny',
  partly: 'partly-sunny',
  cloudy: 'cloud',
  fog: 'cloudy',
  rain: 'rainy',
  sleet: 'rainy',
  snow: 'snow',
  thunder: 'thunderstorm',
};

function partNow(): Part {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'day';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

// The day card (instead of "Welcome!"): a personal greeting, the weather
// where the business is, one line for the day, and what the day holds for
// this person - each item opens where it is dealt with. Until the server's
// card comes, the greeting stands alone, so the top never jumps.
// Where the browser can tell the device's location (the web app).
function geolocation(): Geolocation | null {
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

export function DayCard({ data, right, onPlaceSet }: Props) {
  const { t, dateLocale } = useTranslation();
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const [locating, setLocating] = useState(false);
  // On a narrow phone the greeting is a size smaller, so the name is never cut.
  const narrow = useWindowDimensions().width < 380;
  // Only when nothing the business entered tells where it is, and only for
  // whoever keeps the company's data - one tap, the browser asks first.
  const canLocate = !!data?.place_missing && !!onPlaceSet && hasPermission('manage_company') && !!geolocation();

  const locate = () => {
    const geo = geolocation();
    if (!geo || locating) return;
    setLocating(true);
    geo.getCurrentPosition(
      async (position) => {
        try {
          await api.setWeatherPlace(
            Math.round(position.coords.latitude * 100) / 100,
            Math.round(position.coords.longitude * 100) / 100,
          );
          onPlaceSet?.();
        } catch {
          Toast.info(t('dayCard.locateFailed'));
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        Toast.info(t('dayCard.locateFailed'));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60_000 },
    );
  };

  const part: Part = data?.greeting.part || partNow();
  const name = data?.greeting.name ?? (user?.name || '').trim().split(' ')[0];
  const weather = data?.weather || null;
  const wet = weather && ['rain', 'sleet', 'thunder'].includes(weather.kind);
  const colors = weather?.kind === 'snow' ? SNOW_SKY : wet ? WET_SKY : SKY[part];
  const greeting = t(`dayCard.${part}`);
  const day = data?.date ? parseISO(data.date) : new Date();
  const dateText = format(day, 'EEEE, d MMMM', { locale: dateLocale });
  const icon = weather
    ? (weather.now_kind === 'clear' && part === 'night' ? 'moon' : WEATHER_ICON[weather.now_kind] || WEATHER_ICON[weather.kind])
    : null;
  const items: DayCardItem[] = [...(data?.focus || []), ...(data?.spark ? [data.spark] : [])];

  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={[styles.greeting, narrow && styles.greetingNarrow]} numberOfLines={3}>
            {name ? `${greeting}, ${name}` : greeting}
          </Text>
          <Text style={styles.date} numberOfLines={1}>
            {dateText.charAt(0).toUpperCase() + dateText.slice(1)}
          </Text>
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>

      {weather && icon && (
        <View style={styles.weatherRow}>
          <Ionicons name={icon} size={22} color="#FDE68A" />
          <Text style={styles.weatherNow}>{weather.now != null ? `${weather.now}°` : `${weather.max}°`}</Text>
          <Text style={styles.weatherText} numberOfLines={2}>
            {t('dayCard.weatherLine')
              .replace('{label}', weather.label)
              .replace('{min}', String(weather.min))
              .replace('{max}', String(weather.max))
              .replace(weather.place ? '{place}' : ' · {place}', weather.place || '')}
          </Text>
        </View>
      )}
      {weather?.effect_percent != null && (
        <Text style={styles.effect}>
          {(weather.effect_percent < 0 ? t('dayCard.effectLower') : t('dayCard.effectHigher'))
            .replace('{percent}', String(Math.abs(weather.effect_percent)))}
        </Text>
      )}

      {canLocate && (
        <TouchableOpacity style={styles.locate} onPress={locate} disabled={locating} accessibilityRole="button">
          {locating
            ? <ActivityIndicator size="small" color="#FDE68A" />
            : <Ionicons name="location-outline" size={18} color="#FDE68A" />}
          <View style={styles.locateText}>
            <Text style={styles.locateTitle}>{t('dayCard.locate')}</Text>
            <Text style={styles.locateHint}>{t('dayCard.locateHint')}</Text>
          </View>
        </TouchableOpacity>
      )}

      {!!data?.line?.text && <Text style={styles.line}>{data.line.text}</Text>}

      {items.length > 0 && (
        <View style={styles.items}>
          {items.map((item) => {
            const content = (
              <>
                <Ionicons name={(item.icon as keyof typeof Ionicons.glyphMap) || 'ellipse-outline'} size={14} color="white" />
                <Text style={styles.itemText} numberOfLines={2}>{item.text}</Text>
              </>
            );
            return item.route ? (
              <TouchableOpacity
                key={item.key}
                style={styles.item}
                onPress={() => router.push(item.route as never)}
                accessibilityRole="button"
              >
                {content}
              </TouchableOpacity>
            ) : (
              <View key={item.key} style={styles.item}>{content}</View>
            );
          })}
        </View>
      )}

      {weather && data?.attribution && (
        <Text style={styles.attribution}>{t('dayCard.attribution').replace('{source}', data.attribution)}</Text>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleBlock: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 24, fontWeight: '800', color: 'white', letterSpacing: -0.3 },
  greetingNarrow: { fontSize: 21 },
  date: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  weatherNow: { fontSize: 22, fontWeight: '700', color: 'white' },
  weatherText: { flex: 1, minWidth: 0, fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  effect: { fontSize: 12, color: '#FDE68A', marginTop: 6 },
  locate: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14,
    borderWidth: 1, borderColor: 'rgba(253,230,138,0.35)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
  },
  locateText: { flex: 1, minWidth: 0 },
  locateTitle: { fontSize: 14, fontWeight: '700', color: 'white' },
  locateHint: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  line: { fontSize: 15, lineHeight: 21, color: 'white', marginTop: 12, fontStyle: 'italic' },
  items: { gap: 8, marginTop: 14 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12,
  },
  itemText: { flex: 1, minWidth: 0, fontSize: 13, color: 'white' },
  attribution: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 10, textAlign: 'right' },
});

