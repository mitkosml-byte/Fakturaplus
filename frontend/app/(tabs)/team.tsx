import React, { useCallback, useEffect } from 'react';
import { AmbientGlow } from '../../src/components/AmbientGlow';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { useTranslation } from '../../src/i18n';
import { COLORS } from '../../src/theme/colors';
import { useModules } from '../../src/stores/modulesStore';
import { DayCard } from '../../src/components/home/DayCard';
import { useDayCard } from '../../src/queries/useDayCard';
import { useRevenueEntry } from '../../src/components/home/useRevenueEntry';

// New tab (navigation-architecture review, 2026-10): Calendar and Messages
// used to live as two unrelated entries buried inside Profile's "company"
// category, several taps deep. Payroll/Employee absences lived in
// Profile's "accounting" category but are really about managing people,
// not analyzing money - they fit the same "my team" mental model as
// Calendar/Messages, so they moved here too rather than into Stats.
// This screen is a thin landing page only - all four target screens
// already existed and are unchanged; this just gives them a visible home.
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type CardDef = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  route: '/calendar' | '/messages' | '/payroll' | '/employee-absences' | '/work-schedule';
};

export default function TeamScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { hasPermission, isLoading: authLoading } = useAuth();
  const { uses } = useModules();
  const team = uses('team');
  const payroll = uses('payroll');
  // Whoever has no Home (no statistics) lands here: the day card greets
  // them here instead - their shift, the weather, the team's day.
  const landsHere = !authLoading && !hasPermission('view_statistics');
  const { data: dayCard, refetch: refetchDayCard } = useDayCard(language, landsHere);
  // Whoever enters the till's revenue but has no Home enters it here - the
  // same form as on Home, opening on today.
  const entersRevenue = landsHere && uses('till') && hasPermission('add_revenue');
  const today = useCallback(() => new Date(), []);
  const revenueEntry = useRevenueEntry({ defaultDate: today, onSaved: () => { refetchDayCard(); } });
  // The day card's "yesterday's revenue isn't entered" opens the form on that day.
  const params = useLocalSearchParams<{ revenueDate?: string }>();
  useEffect(() => {
    if (!entersRevenue || !params.revenueDate || !/^\d{4}-\d{2}-\d{2}$/.test(params.revenueDate)) return;
    revenueEntry.open(new Date(`${params.revenueDate}T00:00:00`));
    const clearParamsTimeout = setTimeout(() => router.setParams({ revenueDate: undefined }), 0);
    return () => clearTimeout(clearParamsTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.revenueDate, entersRevenue]);

  const cards: CardDef[] = [
    // Not permission-gated, unlike every other card here - a work
    // schedule is relevant to EVERY team member (they see their own
    // shifts even with no special permission at all), not just managers
    // or team_collaboration holders.
    ...(team ? [{
      key: 'schedule',
      title: t('profile.workSchedule'),
      subtitle: t('profile.workScheduleDesc'),
      icon: 'time' as const,
      iconBg: 'rgba(139, 92, 246, 0.15)',
      iconColor: COLORS.primary,
      route: '/work-schedule' as const,
    }] : []),
    ...(team && hasPermission('team_collaboration')
      ? [{
          key: 'calendar',
          title: t('profile.calendar'),
          subtitle: t('profile.calendarDesc'),
          icon: 'calendar' as const,
          iconBg: 'rgba(139, 92, 246, 0.15)',
          iconColor: COLORS.primary,
          route: '/calendar' as const,
        }]
      : []),
    ...(team && hasPermission('team_collaboration')
      ? [{
          key: 'messages',
          title: t('profile.messages'),
          subtitle: t('profile.messagesDesc'),
          icon: 'chatbubbles' as const,
          iconBg: 'rgba(16, 185, 129, 0.15)',
          iconColor: COLORS.success,
          route: '/messages' as const,
        }]
      : []),
    ...(payroll && hasPermission('manage_payroll')
      ? [{
          key: 'payroll',
          title: t('payroll.title'),
          subtitle: t('profile.payrollDesc'),
          icon: 'people' as const,
          iconBg: 'rgba(16, 185, 129, 0.15)',
          iconColor: COLORS.success,
          route: '/payroll' as const,
        }]
      : []),
    ...(payroll && hasPermission('manage_budget')
      ? [{
          key: 'absences',
          title: t('absences.title'),
          subtitle: t('profile.absencesDesc'),
          icon: 'sunny' as const,
          iconBg: 'rgba(245, 158, 11, 0.15)',
          iconColor: COLORS.warning,
          route: '/employee-absences' as const,
        }]
      : []),
  ];

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <AmbientGlow />
        <SafeAreaView style={styles.container} edges={['top']}>
          <ScrollView style={styles.scrollView}>
            {landsHere && <DayCard data={dayCard} onPlaceSet={() => { refetchDayCard(); }} />}
            {entersRevenue && (
              <TouchableOpacity style={styles.revenueAction} onPress={() => revenueEntry.open()} accessibilityRole="button">
                <View style={styles.revenueIcon}>
                  <Ionicons name="cash" size={24} color="white" />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.revenueTitle}>{t('home.dailyRevenue')}</Text>
                  <Text style={styles.revenueHint}>{t('team.revenueHint')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="white" />
              </TouchableOpacity>
            )}
            {cards.length > 0 && (
              <View style={styles.header}>
                <Text style={styles.title}>{t('team.title')}</Text>
                <Text style={styles.subtitle}>{t('team.subtitle')}</Text>
              </View>
            )}

            {cards.map((card) => (
              <TouchableOpacity
                key={card.key}
                style={styles.card}
                onPress={() => router.push(card.route)}
              >
                <View style={[styles.cardIcon, { backgroundColor: card.iconBg }]}>
                  <Ionicons name={card.icon} size={22} color={card.iconColor} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          {revenueEntry.modal}
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 20,
  },
  revenueAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: COLORS.success,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  revenueIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  revenueTitle: { fontSize: 17, fontWeight: '800', color: 'white' },
  revenueHint: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  cardSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});
