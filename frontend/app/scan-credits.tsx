import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  ImageBackground,
  Linking,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { SimpleSlider } from '../src/components/SimpleSlider';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { downloadAndShareFile } from '../src/utils/downloadFile';
import { ScanBalance, ScanPackage, ScanTransaction } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const PACKAGE_NAME_KEYS: Record<string, string> = {
  small: 'scanCredits.packageNameSmall',
  medium: 'scanCredits.packageNameMedium',
  large: 'scanCredits.packageNameLarge',
  business: 'scanCredits.packageNameBusiness',
};

const RING_RADIUS = 36;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function openCheckout(url: string) {
  if (Platform.OS === 'web') {
    window.location.href = url;
  } else {
    Linking.openURL(url);
  }
}

export default function ScanCreditsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManageBilling = hasPermission('manage_billing');

  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<ScanBalance | null>(null);
  const [packages, setPackages] = useState<ScanPackage[]>([]);
  const [history, setHistory] = useState<ScanTransaction[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const [customQuantity, setCustomQuantity] = useState(50);
  const [customBuying, setCustomBuying] = useState(false);

  const [autoReloadPickerVisible, setAutoReloadPickerVisible] = useState(false);
  const [autoReloadBusy, setAutoReloadBusy] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [balanceData, packagesData, historyData] = await Promise.all([
        api.getScanBalance(),
        api.getScanPackages(),
        api.getScanCreditsHistory(),
      ]);
      setBalance(balanceData);
      setPackages(packagesData);
      setHistory(historyData);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('scanCredits.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const packageName = (pkg: ScanPackage) => t(PACKAGE_NAME_KEYS[pkg.id] || pkg.id) || pkg.name;

  const packageLine = (pkg: ScanPackage) => {
    const paid = pkg.total_scans - pkg.bonus_scans;
    return pkg.bonus_scans > 0
      ? t('scanCredits.packageLineWithBonus')
          .replace('{name}', packageName(pkg))
          .replace('{paid}', String(paid))
          .replace('{bonus}', String(pkg.bonus_scans))
          .replace('{total}', String(pkg.total_scans))
      : t('scanCredits.packageLineNoBonus')
          .replace('{name}', packageName(pkg))
          .replace('{total}', String(pkg.total_scans));
  };

  const bestValueId = packages.length
    ? packages.reduce((best, p) => (p.price_per_scan < best.price_per_scan ? p : best)).id
    : null;

  const customPriceEur = (quantity: number): number => {
    if (!packages.length) return 0;
    const byId = (id: string) => packages.find(p => p.id === id)!;
    const small = byId('small'), medium = byId('medium'), large = byId('large'), business = byId('business');
    let rate: number;
    if (quantity <= small.total_scans) rate = small.price_eur / small.total_scans;
    else if (quantity <= medium.total_scans) rate = medium.price_eur / medium.total_scans;
    else if (quantity <= large.total_scans) rate = large.price_eur / large.total_scans;
    else rate = business.price_eur / business.total_scans;
    return Math.round(quantity * rate * 100) / 100;
  };

  const handleBuyPackage = async (pkg: ScanPackage) => {
    setBuyingId(pkg.id);
    try {
      const { checkout_url } = await api.purchaseScanPackage(pkg.id);
      openCheckout(checkout_url);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBuyingId(null);
    }
  };

  const handleBuyCustom = async () => {
    setCustomBuying(true);
    try {
      const { checkout_url } = await api.purchaseScanCustom(customQuantity);
      openCheckout(checkout_url);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setCustomBuying(false);
    }
  };

  const handleEnableAutoReload = async (pkg: ScanPackage) => {
    setAutoReloadPickerVisible(false);
    setAutoReloadBusy(true);
    try {
      const result = await api.setScanAutoReload(true, pkg.id);
      if (result.checkout_url) openCheckout(result.checkout_url);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setAutoReloadBusy(false);
    }
  };

  const handleStopAutoReload = async () => {
    setAutoReloadBusy(true);
    try {
      await api.setScanAutoReload(false);
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setAutoReloadBusy(false);
    }
  };

  const handleDownloadHistory = async () => {
    try {
      await downloadAndShareFile(api.getScanCreditsHistoryExportUrl(), `skanirania_${Date.now()}.xlsx`);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('scanCredits.loadError'));
    }
  };

  if (loading || !balance) {
    return (
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  const freeFraction = balance.free_quota > 0 ? balance.free_remaining / balance.free_quota : 0;
  const ringColor = freeFraction > 0 ? COLORS.success : COLORS.warning;
  const autoReloadPackage = packages.find(p => p.id === balance.auto_reload_package_id);

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel={t('common.cancel')}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('scanCredits.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Balance card */}
            <View style={styles.card}>
              <View style={styles.balanceRow}>
                <View style={styles.ringWrapper}>
                  <Svg width={84} height={84} viewBox="0 0 84 84">
                    <Circle cx={42} cy={42} r={RING_RADIUS} fill="none" stroke={COLORS.border} strokeWidth={8} />
                    <Circle
                      cx={42} cy={42} r={RING_RADIUS} fill="none" stroke={ringColor} strokeWidth={8}
                      strokeLinecap="round" strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={RING_CIRCUMFERENCE * (1 - freeFraction)}
                      rotation={-90} origin="42, 42"
                    />
                  </Svg>
                  <View style={styles.ringTextWrap}>
                    <Text style={styles.ringNumber}>{balance.free_remaining}/{balance.free_quota}</Text>
                    <Text style={styles.ringLabel}>{t('scanCredits.freeLabel')}</Text>
                  </View>
                </View>
                <View style={styles.balanceInfo}>
                  <Text style={styles.balanceTotal}>{balance.total_remaining}</Text>
                  <Text style={styles.balanceTotalLabel}>{t('scanCredits.totalRemaining')}</Text>
                  <Text style={styles.balanceSubtext}>
                    {balance.purchased_balance > 0
                      ? t('scanCredits.includesPurchased').replace('{count}', String(balance.purchased_balance))
                      : t('scanCredits.freeRenewOn')}
                  </Text>
                </View>
              </View>
            </View>

            {/* History card */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>{t('scanCredits.recentTransactions')}</Text>
              </View>
              {history.length === 0 ? (
                <Text style={styles.emptyHint}>{t('scanCredits.noTransactionsYet')}</Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {history.slice(0, 5).map((tx) => (
                    <View key={tx.id} style={styles.txRow}>
                      <Text style={styles.txDescription} numberOfLines={1}>{tx.description}</Text>
                      <Text style={[styles.txDelta, { color: tx.delta >= 0 ? COLORS.success : COLORS.danger }]}>
                        {tx.delta >= 0 ? `+${tx.delta}` : tx.delta}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              <TouchableOpacity style={styles.secondaryButton} onPress={handleDownloadHistory}>
                <Ionicons name="download-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.secondaryButtonText}>{t('scanCredits.downloadHistory')}</Text>
              </TouchableOpacity>
            </View>

            {/* Packages */}
            <Text style={styles.sectionTitle}>{t('scanCredits.buyPackages')}</Text>
            {packages.map((pkg) => {
              const isBest = pkg.id === bestValueId;
              return (
                <View
                  key={pkg.id}
                  style={[styles.packageCard, isBest && styles.packageCardBest]}
                >
                  {isBest && (
                    <View style={styles.bestBadge}>
                      <Text style={styles.bestBadgeText}>{t('scanCredits.bestValue')}</Text>
                    </View>
                  )}
                  <View style={styles.packageRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.packageName} numberOfLines={2}>{packageLine(pkg)}</Text>
                      <Text style={[styles.packagePerScan, isBest && { color: COLORS.primaryLight }]}>
                        {t('scanCredits.perScan').replace('{price}', pkg.price_per_scan.toFixed(2))}
                      </Text>
                    </View>
                    <View style={styles.packageActions}>
                      <Text style={styles.packagePrice}>{pkg.price_eur.toFixed(2)}&nbsp;&euro;</Text>
                      {canManageBilling && (
                        <TouchableOpacity
                          style={[styles.buyButton, isBest && styles.buyButtonBest]}
                          onPress={() => handleBuyPackage(pkg)}
                          disabled={buyingId === pkg.id}
                        >
                          {buyingId === pkg.id ? (
                            <ActivityIndicator size="small" color="white" />
                          ) : (
                            <Text style={styles.buyButtonText}>{t('scanCredits.buy')}</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}

            {/* Custom amount - purchasing is owner-only (manage_billing),
                same as every package Buy button above. */}
            {canManageBilling && (
              <View style={[styles.card, { marginTop: 4 }]}>
                <Text style={styles.cardTitle}>{t('scanCredits.customAmount')}</Text>
                <Text style={styles.emptyHint}>{t('scanCredits.customAmountHint')}</Text>
                <SimpleSlider
                  style={{ width: '100%', marginTop: 14 }}
                  minimumValue={1}
                  maximumValue={1000}
                  step={1}
                  value={customQuantity}
                  onValueChange={setCustomQuantity}
                  minimumTrackTintColor={COLORS.primary}
                  maximumTrackTintColor={COLORS.border}
                  thumbTintColor={COLORS.primary}
                />
                <View style={styles.customRow}>
                  <Text style={styles.customLabel}>{t('scanCredits.quantityLabel')}</Text>
                  <TextInput
                    style={styles.customInput}
                    keyboardType="number-pad"
                    value={String(customQuantity)}
                    onChangeText={(v) => {
                      const n = parseInt(v, 10);
                      if (!isNaN(n)) setCustomQuantity(Math.min(1000, Math.max(1, n)));
                      else if (v === '') setCustomQuantity(1);
                    }}
                  />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={styles.packagePrice}>{customPriceEur(customQuantity).toFixed(2)}&nbsp;&euro;</Text>
                    <Text style={styles.packagePerScan}>
                      {t('scanCredits.perScan').replace('{price}', (customPriceEur(customQuantity) / customQuantity).toFixed(2))}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.buyWideButton} onPress={handleBuyCustom} disabled={customBuying}>
                  {customBuying ? <ActivityIndicator size="small" color="white" /> : (
                    <Text style={styles.buyButtonText}>{t('scanCredits.buyThisAmount')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Auto-reload - same owner-only gate. */}
            {canManageBilling && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>{t('scanCredits.autoReload')}</Text>
                  {autoReloadBusy && <ActivityIndicator size="small" color={COLORS.primary} />}
                </View>
                {balance.auto_reload_enabled && autoReloadPackage ? (
                  <>
                    <Text style={styles.emptyHint}>
                      {t('scanCredits.autoReloadActiveWith')
                        .replace('{name}', packageName(autoReloadPackage))
                        .replace('{count}', String(autoReloadPackage.total_scans))}
                    </Text>
                    <TouchableOpacity style={styles.stopAutoReloadButton} onPress={handleStopAutoReload} disabled={autoReloadBusy}>
                      <Text style={styles.stopAutoReloadText}>{t('scanCredits.stopAutoReload')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.emptyHint}>{t('scanCredits.autoReloadHint')}</Text>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => setAutoReloadPickerVisible(true)}
                      disabled={autoReloadBusy}
                    >
                      <Ionicons name="repeat" size={14} color={COLORS.textSecondary} />
                      <Text style={styles.secondaryButtonText}>{t('scanCredits.chooseAutoReloadPackage')}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>

      <Modal visible={autoReloadPickerVisible} animationType="fade" transparent onRequestClose={() => setAutoReloadPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.cardTitle}>{t('scanCredits.chooseAutoReloadPackage')}</Text>
            <View style={{ gap: 8, marginTop: 14 }}>
              {packages.map((pkg) => (
                <TouchableOpacity key={pkg.id} style={styles.modalPackageRow} onPress={() => handleEnableAutoReload(pkg)}>
                  <Text style={styles.modalPackageText}>{packageLine(pkg)}</Text>
                  <Text style={styles.packagePrice}>{pkg.price_eur.toFixed(2)}&nbsp;&euro;</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.closeModalButton} onPress={() => setAutoReloadPickerVisible(false)}>
              <Text style={styles.closeModalText}>{t('scanCredits.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.surface,
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: 'white' },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 40 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 18 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: 'white' },
  emptyHint: { fontSize: 11.5, color: COLORS.textMuted, lineHeight: 17, marginTop: 2 },
  balanceRow: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  ringWrapper: { width: 84, height: 84 },
  ringTextWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  ringNumber: { fontSize: 17, fontWeight: '700', color: 'white' },
  ringLabel: { fontSize: 9, color: COLORS.textMuted, marginTop: 2 },
  balanceInfo: { flex: 1, minWidth: 0 },
  balanceTotal: { fontSize: 32, fontWeight: '700', color: 'white', lineHeight: 36 },
  balanceTotalLabel: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  balanceSubtext: { fontSize: 11, color: COLORS.textMuted, marginTop: 6 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  txDescription: { flex: 1, fontSize: 12, color: COLORS.textSubtle },
  txDelta: { fontSize: 12, fontWeight: '600' },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  secondaryButtonText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: 'white', marginTop: 4 },
  packageCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, position: 'relative',
  },
  packageCardBest: { borderWidth: 1.5, borderColor: COLORS.primary },
  bestBadge: {
    position: 'absolute', top: -10, right: 14, backgroundColor: COLORS.primary,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  bestBadgeText: { color: 'white', fontSize: 10, fontWeight: '700' },
  packageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  packageName: { fontSize: 14, fontWeight: '600', color: 'white' },
  packagePerScan: { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
  packageActions: { alignItems: 'flex-end', gap: 8, flexShrink: 0 },
  packagePrice: { fontSize: 16, fontWeight: '700', color: 'white' },
  buyButton: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: COLORS.border, minWidth: 64, alignItems: 'center' },
  buyButtonBest: { backgroundColor: COLORS.primary },
  buyButtonText: { color: 'white', fontSize: 13, fontWeight: '600' },
  buyWideButton: {
    width: '100%', marginTop: 14, padding: 12, borderRadius: 10,
    backgroundColor: COLORS.border, alignItems: 'center',
  },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  customLabel: { fontSize: 12, color: COLORS.textSecondary },
  customInput: {
    width: 70, padding: 8, borderRadius: 8, backgroundColor: COLORS.background,
    borderWidth: 1, borderColor: COLORS.border, color: 'white', fontSize: 13,
  },
  stopAutoReloadButton: { marginTop: 14, padding: 10, borderRadius: 10, alignItems: 'center' },
  stopAutoReloadText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalContent: { width: '100%', backgroundColor: COLORS.surface, borderRadius: 20, padding: 22 },
  modalPackageRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, borderRadius: 10, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  modalPackageText: { flex: 1, fontSize: 13, color: 'white', marginRight: 10 },
  closeModalButton: { marginTop: 16, padding: 10, alignItems: 'center' },
  closeModalText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
});
