import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  ImageBackground,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, formatDistanceToNow, isToday, parseISO } from 'date-fns';
import { api } from '../src/services/api';
import type { SystemError, SystemJob, SystemJobState, SystemStatus } from '../src/types';
import { useTranslation } from '../src/i18n';
import { AccessDenied, ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const STATE_COLOR: Record<SystemJobState, string> = {
  ok: COLORS.success,
  failing: COLORS.danger,
  late: COLORS.warning,
  waiting: COLORS.textMuted,
  off: COLORS.textMuted,
};

const FEATURES = ['ai', 'email', 'payments', 'push'] as const;

// The "Състояние" screen: whether the server, the database and the
// automatic jobs work, and the errors of the last day - the owner's own
// company's; every company's for the person who runs the program.
export default function SystemStatusScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [openTrace, setOpenTrace] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.getSystemStatus());
      setFailed(null);
    } catch (error: any) {
      if (error?.status === 403) setDenied(true);
      else setFailed(error?.message ?? String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const time = (iso: string | null) => {
    if (!iso) return '—';
    const when = parseISO(iso);
    return isToday(when) ? format(when, 'HH:mm', { locale: dateLocale }) : format(when, 'd MMM HH:mm', { locale: dateLocale });
  };
  const ago = (iso: string | null) => (iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: dateLocale }) : '—');

  if (denied) return <AccessDenied />;

  const jobsWithTrouble = status?.jobs.filter((job) => job.state === 'failing' || job.state === 'late') ?? [];
  const allGood = !!status && status.database.ok && jobsWithTrouble.length === 0 && status.errors.count === 0;

  const renderJob = (job: SystemJob) => (
    <View key={job.key} style={styles.row}>
      <View style={[styles.dot, { backgroundColor: STATE_COLOR[job.state] }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{t(`status.job.${job.key}`)}</Text>
        <Text style={styles.rowSub}>
          {t(`status.state.${job.state}`)}
          {job.state !== 'off' ? ` · ${t('status.every').replace('{minutes}', String(job.every_minutes))}` : ''}
          {job.last_run_at ? ` · ${t('status.lastRun').replace('{time}', ago(job.last_run_at))}` : ''}
        </Text>
        {!!job.last_error && job.state === 'failing' && <Text style={styles.errorText}>{job.last_error}</Text>}
      </View>
    </View>
  );

  const renderError = (item: SystemError) => {
    const open = openTrace === item.id;
    return (
      <View key={item.id} style={styles.errorCard}>
        <View style={styles.errorTop}>
          <View style={styles.sourceChip}>
            <Text style={styles.sourceText}>{t(`status.source.${item.source}`)}</Text>
          </View>
          <Text style={styles.errorWhere} numberOfLines={2}>{item.where}</Text>
        </View>
        {status?.scope === 'all' && !!item.company_name && <Text style={styles.rowSub}>{item.company_name}</Text>}
        <Text style={styles.errorText} numberOfLines={open ? undefined : 3}>
          {item.kind}: {item.message}
        </Text>
        <Text style={styles.rowSub}>
          {item.count === 1 ? t('status.once') : t('status.times').replace('{count}', String(item.count))} · {time(item.last_at)}
        </Text>
        {!!item.trace && (
          <>
            <TouchableOpacity onPress={() => setOpenTrace(open ? null : item.id)} style={styles.detailsButton}>
              <Text style={styles.detailsText}>{open ? t('status.hideDetails') : t('status.showDetails')}</Text>
            </TouchableOpacity>
            {open && <Text style={styles.trace} selectable>{item.trace}</Text>}
          </>
        )}
      </View>
    );
  };

  return (
    <ScreenEnter>
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.iconButton} accessibilityLabel={t('common.back')}>
                <Ionicons name="arrow-back" size={24} color="white" />
              </TouchableOpacity>
              <Text style={styles.title}>{t('status.title')}</Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: 40 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
            >
              <Text style={styles.intro}>{status?.scope === 'all' ? t('status.introAll') : t('status.intro')}</Text>

              {loading ? (
                <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
              ) : !status ? (
                <View style={styles.card}>
                  <Text style={styles.errorText}>{failed}</Text>
                  <TouchableOpacity style={styles.primaryButton} onPress={() => { setLoading(true); load(); }}>
                    <Text style={styles.primaryButtonText}>{t('errorBoundary.retry')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={[styles.summary, { borderColor: allGood ? COLORS.success : COLORS.warning }]}>
                    <Ionicons
                      name={allGood ? 'checkmark-circle' : 'alert-circle'}
                      size={28}
                      color={allGood ? COLORS.success : COLORS.warning}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.summaryTitle}>{allGood ? t('status.allGood') : t('status.problems')}</Text>
                      <Text style={styles.rowSub}>{t('status.checked').replace('{time}', time(status.checked_at))}</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionTitle}>{t('status.section.server')}</Text>
                  <View style={styles.card}>
                    <View style={styles.row}>
                      <View style={[styles.dot, { backgroundColor: COLORS.success }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{t('status.serverUp').replace('{time}', time(status.server.started_at))}</Text>
                        {!!status.server.version && (
                          <Text style={styles.rowSub}>{t('status.version').replace('{version}', status.server.version)}</Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.row}>
                      <View style={[styles.dot, { backgroundColor: status.database.ok ? COLORS.success : COLORS.danger }]} />
                      <Text style={[styles.rowTitle, { flex: 1 }]}>
                        {status.database.ok
                          ? t('status.dbOk').replace('{ms}', String(status.database.ms ?? 0))
                          : t('status.dbDown')}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.sectionTitle}>{t('status.section.features')}</Text>
                  <View style={styles.card}>
                    {FEATURES.map((key) => (
                      <View key={key} style={styles.row}>
                        <View style={[styles.dot, { backgroundColor: status.features[key] ? COLORS.success : COLORS.textMuted }]} />
                        <Text style={[styles.rowTitle, { flex: 1 }]}>{t(`status.feature.${key}`)}</Text>
                        <Text style={[styles.rowSub, { marginTop: 0 }]}>{status.features[key] ? t('status.on') : t('status.off')}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.sectionTitle}>{t('status.section.jobs')}</Text>
                  <View style={styles.card}>{status.jobs.map(renderJob)}</View>

                  <Text style={styles.sectionTitle}>
                    {t('status.section.errors')}
                    {status.errors.count > 0 ? ` · ${status.errors.count}` : ''}
                  </Text>
                  {status.errors.items.length === 0 ? (
                    <View style={styles.card}>
                      <Text style={styles.rowTitle}>{t('status.noErrors')}</Text>
                    </View>
                  ) : (
                    status.errors.items.map(renderError)
                  )}
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  content: { flex: 1, padding: 16 },
  intro: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginBottom: 12 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  summaryTitle: { color: 'white', fontSize: 16, fontWeight: '700' },
  sectionTitle: { color: 'white', fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  rowTitle: { color: 'white', fontSize: 14, fontWeight: '600' },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 },
  errorCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  errorTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceChip: { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  sourceText: { color: COLORS.danger, fontSize: 12, fontWeight: '600' },
  errorWhere: { color: 'white', fontSize: 13, fontWeight: '600', flex: 1 },
  errorText: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 },
  detailsButton: { marginTop: 8, alignSelf: 'flex-start' },
  detailsText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  trace: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 13, alignItems: 'center', marginVertical: 10 },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
});
