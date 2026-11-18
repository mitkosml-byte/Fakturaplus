import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams, Redirect } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import { api } from '../../src/services/api';
import { Summary, NonInvoiceExpense, GettingStarted, HomeData } from '../../src/types';
import { queryClient } from '../../src/queries/queryClient';
import { scanBalanceQueryKey } from '../../src/queries/useScanBalance';
import { format, subDays } from 'date-fns';
import { bg } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import { useAuth } from '../../src/contexts/AuthContext';
import ExcelImportModal from '../../src/components/ExcelImportModal';
import { PeriodNavigator, PeriodSoFarNote } from '../../src/components/PeriodNavigator';
import { useSharedPeriod } from '../../src/utils/sharedPeriod';
import { ScanCreditsBadge, useDirectionalReveal, CountUp, SkeletonStat, CelebrationGlow, MorningBriefingCard, LockedValue, LocationPicker } from '../../src/components';
import { useLocationChoice, useLocationsStore } from '../../src/stores/locationsStore';
import Animated from 'react-native-reanimated';
import { PeriodState, getPeriodBounds, toApiDate } from '../../src/utils/periodRange';
import { COLORS } from '../../src/theme/colors';
import { restrictedDataNote } from '../../src/utils/visibilityNote';
import { RevenueModal, rateAmountsTotal } from '../../src/components/home/RevenueModal';
import type { VatGroupAmount, ZReportResult } from '../../src/types';
import { ExpenseModal } from '../../src/components/home/ExpenseModal';
import { BillingOverviewCard } from '../../src/components/home/BillingOverviewCard';
import { GettingStartedCard } from '../../src/components/home/GettingStartedCard';
import { pickScanImage } from '../../src/utils/scanImage';
import { useModules } from '../../src/stores/modulesStore';
import { useShowTeamTab } from '../../src/hooks/useTeamTab';
import { useOnboardingStore } from '../../src/stores/onboardingStore';
import { getDescriptionSuggestions } from '../../src/utils/expenseSuggestions';
import { formatAmount, formatMoney } from '../../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function HomeScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { user, hasPermission, isLoading: authLoading } = useAuth();
  // Home shows what the business uses (У3): a business without a till sees
  // no till revenue, average per day or pocket money; one that invoices
  // sees what it issued and what customers owe, with "+ Фактура".
  const { uses } = useModules();
  const usesTill = uses('till');
  const usesBilling = uses('billing');
  const showTeamTab = useShowTeamTab();
  const router = useRouter();
  const ocrParams = useLocalSearchParams<{ ocrDate?: string; ocrFiscalRevenue?: string; ocrVatRate?: string; revenueDate?: string }>();

  const [summary, setSummary] = useState<Summary | null>(null);
  // Everything else Home shows came in the same answer (Л14).
  const [home, setHome] = useState<HomeData | null>(null);
  const showBilling = usesBilling && (hasPermission('add_revenue') || hasPermission('issue_invoices'));
  const [askText, setAskText] = useState('');
  // An empty question just opens the assistant.
  const askNumbers = () => {
    const question = askText.trim();
    setAskText('');
    router.push(question ? { pathname: '/ask-my-numbers', params: { q: question } } : '/ask-my-numbers');
  };
  // A business that has entered nothing yet sees where to start, not zeros.
  const [startStatus, setStartStatus] = useState<GettingStarted | null>(null);
  const nothingYet = !!startStatus && !startStatus.revenue && !startStatus.invoice && !startStatus.expense && !startStatus.issued;
  // Which period the dashboard cards below are showing - defaults to the
  // current (in-progress) calendar month, matching the previous hardcoded
  // behavior, but lets the user step back to any past day/week/month/year
  // or a custom range instead of the cards just going silent at zero on the
  // 1st of a new month with no way back to see where last month's data went.
  // The period every report screen shares (src/utils/sharedPeriod) - the
  // one picked here is the one Statistics, suppliers and items open on.
  const [periodState, setPeriodState] = useSharedPeriod();

  // #17: the ‹ › arrows get a directional slide instead of the numbers
  // just jumping - new data enters from the direction of travel. Only the
  // arrows (offset changes within the same mode) carry a direction; a
  // mode switch or a manual range-date edit just cross-fades.
  const periodReveal = useDirectionalReveal(
    `${periodState.mode}-${periodState.offset}-${periodState.rangeStart ?? ''}-${periodState.rangeEnd ?? ''}`
  );
  const handlePeriodChange = (next: PeriodState) => {
    if (next.mode === periodState.mode && next.offset !== periodState.offset) {
      periodReveal.setDirection(next.offset > periodState.offset ? -1 : 1);
    }
    setPeriodState(next);
  };

  // Quick-add revenue/expense should land inside whatever period the
  // navigator above is showing, not always on today's real date - otherwise
  // opening "Дневен оборот" while looking back at September silently adds a
  // record to October instead, and the dashboard you're looking at never
  // reflects it. Clamped to today for the current/future-reaching periods,
  // since you can't log revenue for a day that hasn't happened yet.
  const getDefaultActionDate = useCallback(() => {
    const bounds = getPeriodBounds(periodState);
    const now = new Date();
    return bounds.end > now ? now : bounds.end;
  }, [periodState]);

  const [refreshing, setRefreshing] = useState(false);
  const [revenueModalVisible, setRevenueModalVisible] = useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [importRevenueModalVisible, setImportRevenueModalVisible] = useState(false);
  const [importExpenseModalVisible, setImportExpenseModalVisible] = useState(false);

  // Revenue form
  const [fiscalRevenue, setFiscalRevenue] = useState('');
  const [pocketMoney, setPocketMoney] = useState('');
  const [cardRevenue, setCardRevenue] = useState('');
  const [revenueVatRate, setRevenueVatRate] = useState(20);
  // The day's till sales by VAT rate (rate -> typed amount), as the till's
  // daily report gives them - used instead of one total at one rate.
  const [revenueSplitByRate, setRevenueSplitByRate] = useState(false);
  const [revenueRateAmounts, setRevenueRateAmounts] = useState<Record<number, string>>({});
  const [revenueDate, setRevenueDate] = useState(new Date());
  // Shared across the revenue/expense/personal-expense modals below - only
  // one is ever open at a time, and this guards against a rapid double-tap
  // on Save creating a duplicate record.
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  // Which location a day's revenue or an expense is for (Н11): until
  // picked, the one used last on this device. Nothing shows without locations.
  const { fallback: defaultLocation } = useLocationChoice();
  const rememberLocation = useLocationsStore((state) => state.remember);
  const [revenueLocationPick, setRevenueLocationPick] = useState<string | null | undefined>(undefined);
  const revenueLocation = revenueLocationPick === undefined ? defaultLocation : revenueLocationPick;
  const [expenseLocationPick, setExpenseLocationPick] = useState<string | null | undefined>(undefined);
  const expenseLocation = expenseLocationPick === undefined ? defaultLocation : expenseLocationPick;

  // Expense form
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDescriptionError, setExpenseDescriptionError] = useState(false);
  const [expenseAmountError, setExpenseAmountError] = useState(false);
  const [expenseDate, setExpenseDate] = useState(new Date());
  const [dayExpenses, setDayExpenses] = useState<Array<{id: string; description: string; amount: number; date: string}>>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  // Full (unfiltered) expense history, loaded once when the modal first
  // opens - drives the "Recent" quick-fill chips, independent of whatever
  // single day dayExpenses above is currently scoped to.
  const [expenseSuggestionSource, setExpenseSuggestionSource] = useState<NonInvoiceExpense[]>([]);
  
  // Date picker states
  const [isRevenueDatePickerVisible, setRevenueDatePickerVisible] = useState(false);
  const [isExpenseDatePickerVisible, setExpenseDatePickerVisible] = useState(false);

  // Celebrates a genuine milestone - the period crossing from non-profitable
  // into profitable - not routine saves, which would turn it into noise.
  // prevProfitRef holds the last value we actually SAW (not the initial
  // null), so the very first load of a never-profitable account doesn't
  // read as "just crossed into profit".
  const prevProfitRef = useRef<number | null>(null);
  const [celebrateProfit, setCelebrateProfit] = useState(false);

  // The two calls below are independent (same date bounds, different
  // endpoints) but used to run one after the other - on a mobile network
  // where each round trip costs a few hundred ms, that doubled the time
  // before the screen settled on every single focus. Promise.all fires
  // them together; each keeps its own try/catch so one failing still lets
  // the other's result through, matching the previous behavior.
  const loadData = useCallback(async () => {
    const bounds = getPeriodBounds(periodState);
    const start_date = toApiDate(bounds.start);
    const end_date = toApiDate(bounds.end);

    await Promise.all([
      (async () => {
        try {
          // Home in one request (Л14): the numbers, the day's review, the
          // first steps, the invoicing card and the scans left.
          const data = await api.getHome({ start_date, end_date, with_billing: showBilling });
          setHome(data);
          if (data.getting_started) setStartStatus(data.getting_started);
          // The scans left are kept for the other screens' badges too.
          if (data.scan_credits) queryClient.setQueryData(scanBalanceQueryKey, data.scan_credits);
          const summaryData = data.summary;
          if (!summaryData) return;
          setSummary(summaryData);
          const newProfit = summaryData.profit;
          if (
            prevProfitRef.current !== null &&
            prevProfitRef.current <= 0 &&
            typeof newProfit === 'number' &&
            newProfit > 0
          ) {
            setCelebrateProfit(true);
          }
          if (typeof newProfit === 'number') {
            prevProfitRef.current = newProfit;
          }
        } catch (error) {
          console.error('Error loading data:', error);
        }
      })(),
    ]);
  }, [periodState, showBilling]);

  // Pre-fills the form with whatever is already logged for this date, so
  // saving corrects that value directly instead of adding a delta to it -
  // opening the form for a date with nothing logged yet leaves it at 0.
  // Returns what it found (or null) so callers - like the OCR hand-off
  // below - can react to whether the day already had something logged.
  // A day's VAT split into the form: by rate when the day has its groups,
  // else one total at one rate.
  const showRevenueVat = useCallback((groups: VatGroupAmount[] | undefined, rate: number | undefined) => {
    setRevenueVatRate(rate ?? 20);
    if (groups && groups.length > 0) {
      setRevenueSplitByRate(true);
      setRevenueRateAmounts(Object.fromEntries(groups.map((g) => [g.rate_percent, g.amount.toFixed(2)])));
    } else {
      setRevenueSplitByRate(false);
      setRevenueRateAmounts({});
    }
  }, []);

  // With locations, the day of the location picked (none picked: what no
  // location holds) - the part a save replaces.
  const fetchRevenueDay = useCallback(async (date: Date, locationId: string | null) => {
    try {
      return await api.getRevenueByDate(format(date, 'yyyy-MM-dd'), locationId);
    } catch {
      return null;
    }
  }, []);

  const showRevenueDay = useCallback((data: Awaited<ReturnType<typeof api.getRevenueByDate>> | null) => {
    setFiscalRevenue(data && data.fiscal_revenue > 0 ? data.fiscal_revenue.toString() : '');
    setPocketMoney(data && data.pocket_money > 0 ? data.pocket_money.toString() : '');
    setCardRevenue(data && data.card_revenue > 0 ? data.card_revenue.toString() : '');
    showRevenueVat(data?.vat_groups ?? [], data?.vat_rate_percent ?? 20);
  }, [showRevenueVat]);

  // Switches the form between one rate and the day by rate, keeping what
  // is typed: the total goes to its rate, or the split adds up to the
  // total at the rate of most of it.
  const toggleRevenueSplitByRate = () => {
    if (revenueSplitByRate) {
      const amounts = Object.entries(revenueRateAmounts).map(([rate, value]) => [Number(rate), parseFloat(value) || 0] as const);
      const total = rateAmountsTotal(revenueRateAmounts);
      const largest = amounts.reduce((best, item) => (item[1] > best[1] ? item : best), [revenueVatRate, 0] as const);
      setFiscalRevenue(total > 0 ? total.toFixed(2) : '');
      setRevenueVatRate(largest[0]);
      setRevenueRateAmounts({});
      setRevenueSplitByRate(false);
    } else {
      setRevenueRateAmounts(fiscalRevenue ? { [revenueVatRate]: fiscalRevenue } : {});
      setRevenueSplitByRate(true);
    }
  };

  // One-tap "copy yesterday's split forward" for a steady-traffic day -
  // reuses the same getRevenueByDate call loadCurrentDayRevenue already
  // makes, just for revenueDate - 1, and overwrites the form the same way
  // opening the modal pre-fills it.
  const [copyingYesterday, setCopyingYesterday] = useState(false);
  const handleCopyYesterday = async () => {
    setCopyingYesterday(true);
    try {
      const yesterdayStr = format(subDays(revenueDate, 1), 'yyyy-MM-dd');
      const data = await api.getRevenueByDate(yesterdayStr, revenueLocation);
      if (!data || (data.fiscal_revenue === 0 && data.card_revenue === 0 && data.pocket_money === 0)) {
        Alert.alert(t('home.sameAsYesterday'), t('home.sameAsYesterdayEmpty'));
        return;
      }
      setFiscalRevenue(data.fiscal_revenue > 0 ? data.fiscal_revenue.toString() : '');
      setPocketMoney(data.pocket_money > 0 ? data.pocket_money.toString() : '');
      setCardRevenue(data.card_revenue > 0 ? data.card_revenue.toString() : '');
      showRevenueVat(data.vat_groups, data.vat_rate_percent);
      Haptics.success();
      Toast.success(t('home.sameAsYesterdayApplied'));
    } catch {
      Alert.alert(t('home.sameAsYesterday'), t('home.sameAsYesterdayEmpty'));
    } finally {
      setCopyingYesterday(false);
    }
  };

  // Tab screens stay mounted, so returning here (e.g. after scanning and
  // saving a new invoice) doesn't remount the screen - only re-fetching on
  // focus picks up the change without needing a manual pull-to-refresh.
  //
  // authLoading is in the dependency list for a second reason, not just
  // "skip while unauthenticated": on a fresh page load (not a tab switch
  // within an already-running app), Home is "/" - the very first route -
  // so it mounts and this effect fires before AuthProvider's checkAuth()
  // has finished reading the stored token out of (async, even on web)
  // AsyncStorage. That first loadData() call used to go out with no auth
  // at all, fail with 401, and since nothing else ever re-triggers a focus
  // event on its own, the summary card (and everything chained off it
  // below - MorningBriefingCard) stayed stuck on its
  // loading skeleton forever, until the user manually switched tabs and
  // back. useFocusEffect's own implementation re-runs its effect whenever
  // the memoized callback's identity changes while the screen is still
  // focused (see its [effect, navigation] dependency list), so adding
  // authLoading here both skips the doomed first call AND, once it flips
  // to false a moment later, fires the real one - no separate effect needed.
  useFocusEffect(
    useCallback(() => {
      if (!authLoading) loadData();
    }, [loadData, authLoading])
  );

  // The first-start answer changes what Home shows (the parts, the VAT):
  // once it is given, everything here loads again.
  const onboardingOpen = useOnboardingStore((state) => state.isVisible);
  const wasOnboardingOpen = useRef(false);
  useEffect(() => {
    if (wasOnboardingOpen.current && !onboardingOpen) loadData();
    wasOnboardingOpen.current = onboardingOpen;
  }, [onboardingOpen, loadData]);

  // Set by the scan screen's "sales" mode hand-off (see the effect below) -
  // a ref, not state, so consuming it doesn't itself retrigger the load
  // effect it's read from.
  const pendingOcrRevenueRef = useRef<{ amount: number; vatRate: 20 | 9 | 0 } | null>(null);
  const [ocrAdditionNote, setOcrAdditionNote] = useState<string | null>(null);

  // The till's daily report read from a photo (Н3): the whole day as the
  // report gives it - it replaces what the form holds (a report is the
  // day's total, not something added to it). For another day than the
  // form's, it waits until that day is loaded, then fills it.
  const pendingZReportRef = useRef<ZReportResult | null>(null);
  const [scanningReport, setScanningReport] = useState(false);
  const applyZReport = (report: ZReportResult) => {
    setFiscalRevenue(report.fiscal_revenue > 0 ? report.fiscal_revenue.toFixed(2) : '');
    setCardRevenue(report.card_revenue != null && report.card_revenue > 0 ? report.card_revenue.toFixed(2) : '');
    // Several rates: the day by rate. One: that rate. None read: the form
    // keeps the rate it has (the server says to check it).
    if (report.vat_groups.length > 1) {
      showRevenueVat(report.vat_groups, report.vat_groups[0].rate_percent);
    } else if (report.vat_groups.length === 1) {
      showRevenueVat([], report.vat_groups[0].rate_percent);
    }
    setOcrAdditionNote(
      report.report_number
        ? t('home.zReportApplied').replace('{number}', report.report_number)
        : t('home.zReportAppliedNoNumber')
    );
    if (report.warnings.length > 0) {
      Alert.alert(t('home.zReportCheck'), report.warnings.join('\n\n'));
    }
  };
  const scanReportFrom = async (source: 'camera' | 'library') => {
    let image: string | null = null;
    try {
      image = await pickScanImage(source);
    } catch {
      Alert.alert(t('common.error'), t('scan.cameraError'));
      return;
    }
    if (!image) return;
    setScanningReport(true);
    try {
      const report = await api.scanZReport([image]);
      const sameDay = !report.date || report.date === format(revenueDate, 'yyyy-MM-dd');
      if (sameDay) {
        applyZReport(report);
      } else {
        pendingZReportRef.current = report;
        setRevenueDate(new Date(`${report.date}T00:00:00`));
      }
      Haptics.success();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setScanningReport(false);
    }
  };
  const handleScanReport = () => {
    Alert.alert(t('home.scanReport'), t('home.scanReportHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('scan.fromGallery'), onPress: () => scanReportFrom('library') },
      { text: t('scan.takePhoto'), onPress: () => scanReportFrom('camera') },
    ]);
  };

  // Load current day revenue when revenue modal opens or date changes, then
  // fold in a pending OCR-scanned sale on top of whatever was already
  // there - never replacing it - so scanning a receipt for a day that
  // already has manually-logged sales adds to the total instead of erasing it.
  useEffect(() => {
    if (!revenueModalVisible) return;
    let stale = false;
    (async () => {
      const existing = await fetchRevenueDay(revenueDate, revenueLocation);
      // Another day or location was picked meanwhile - its own load shows it.
      if (stale) return;
      showRevenueDay(existing);
      const pending = pendingOcrRevenueRef.current;
      if (pending) {
        const existingFiscal = existing?.fiscal_revenue || 0;
        const existingRate = existing?.vat_rate_percent ?? 20;
        const existingGroups = existing?.vat_groups || [];
        if (existingGroups.length > 0 || (existingFiscal > 0 && existingRate !== pending.vatRate)) {
          // A sale at another rate than the rest of the day: the day by
          // rate, the sale added to its own rate's sales.
          const amounts: Record<number, number> = existingGroups.length > 0
            ? Object.fromEntries(existingGroups.map((g) => [g.rate_percent, g.amount]))
            : { [existingRate]: existingFiscal };
          amounts[pending.vatRate] = (amounts[pending.vatRate] || 0) + pending.amount;
          setRevenueRateAmounts(Object.fromEntries(Object.entries(amounts).map(([rate, amount]) => [rate, amount.toFixed(2)])));
          setRevenueSplitByRate(true);
        } else {
          setFiscalRevenue((existingFiscal + pending.amount).toFixed(2));
          setRevenueVatRate(pending.vatRate);
        }
        setOcrAdditionNote(
          t('home.ocrAdditionNote').replace('{amount}', formatAmount(pending.amount))
        );
        pendingOcrRevenueRef.current = null;
      } else if (pendingZReportRef.current) {
        const report = pendingZReportRef.current;
        pendingZReportRef.current = null;
        applyZReport(report);
      } else {
        setOcrAdditionNote(null);
      }
    })();
    // t() is a plain function from useTranslation(), recreated on every
    // render (not memoized) - listing it here would refire this effect on
    // every render and re-fetch/overwrite the addition it just applied.
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueModalVisible, revenueDate, revenueLocation, fetchRevenueDay, showRevenueDay]);

  // Hand-off from the scan screen's "sales" mode: a receipt/invoice the
  // business itself issued was recognized there, and its amount/date/VAT
  // rate arrive as router params so this reuses the SAME modal (and its
  // existing-value loading above) rather than a separate save path that
  // could silently overwrite the day's other sales.
  useEffect(() => {
    if (!ocrParams.ocrDate || !ocrParams.ocrFiscalRevenue) return;
    const amount = parseFloat(ocrParams.ocrFiscalRevenue) || 0;
    const vatRateNum = parseInt(ocrParams.ocrVatRate || '20', 10);
    const vatRate: 20 | 9 | 0 = vatRateNum === 9 ? 9 : vatRateNum === 0 ? 0 : 20;
    pendingOcrRevenueRef.current = { amount, vatRate };
    setRevenueDate(new Date(`${ocrParams.ocrDate}T00:00:00`));
    setRevenueModalVisible(true);
    // Deferred to the next tick - calling this in the same pass as a
    // fresh navigation (e.g. this screen just mounted from the hand-off
    // itself) can fire before Expo Router's root layout has finished
    // mounting, which throws.
    const clearParamsTimeout = setTimeout(() => {
      router.setParams({ ocrDate: undefined, ocrFiscalRevenue: undefined, ocrVatRate: undefined });
    }, 0);
    return () => clearTimeout(clearParamsTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrParams.ocrDate, ocrParams.ocrFiscalRevenue, ocrParams.ocrVatRate]);

  // Hand-off from the morning briefing's "missing revenue" signal: opens
  // the same modal on the exact day that has nothing entered yet.
  useEffect(() => {
    if (!ocrParams.revenueDate || ocrParams.ocrDate || !/^\d{4}-\d{2}-\d{2}$/.test(ocrParams.revenueDate)) return;
    setRevenueDate(new Date(`${ocrParams.revenueDate}T00:00:00`));
    setRevenueModalVisible(true);
    const clearParamsTimeout = setTimeout(() => {
      router.setParams({ revenueDate: undefined });
    }, 0);
    return () => clearTimeout(clearParamsTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrParams.revenueDate]);

  // Load expenses for selected date when expense modal opens or date changes
  const loadDayExpenses = useCallback(async (date: Date) => {
    setLoadingExpenses(true);
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const expenses = await api.getExpenses({
        start_date: dateStr,
        end_date: dateStr
      });
      setDayExpenses(expenses);
    } catch (error) {
      setDayExpenses([]);
    } finally {
      setLoadingExpenses(false);
    }
  }, []);

  useEffect(() => {
    if (expenseModalVisible) {
      loadDayExpenses(expenseDate);
    }
  }, [expenseModalVisible, expenseDate, loadDayExpenses]);

  useEffect(() => {
    if (!expenseModalVisible || expenseSuggestionSource.length > 0) return;
    api.getExpenses({}).then(setExpenseSuggestionSource).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseModalVisible]);

  const expenseSuggestions = useMemo(
    () => getDescriptionSuggestions(expenseSuggestionSource),
    [expenseSuggestionSource]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleDeleteExpense = async (expenseId: string) => {
    Alert.alert(
      t('common.delete'),
      t('msg.deleteConfirmExpense'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteExpense(expenseId);
              loadDayExpenses(expenseDate);
              loadData();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          }
        }
      ]
    );
  };

  // Dismissing without saving must not leave revenueDate pointing at
  // whatever day was last browsed with the prev/next arrows or the date
  // picker - otherwise the NEXT tap of the "Дневен оборот" quick action
  // silently reopens on that stale day instead of the one matching the
  // currently-viewed period, and a correction typed there lands on the
  // wrong date while the dashboard you're looking at looks unchanged.
  const closeRevenueModal = () => {
    setRevenueModalVisible(false);
    setRevenueLocationPick(undefined);
    setRevenueDate(getDefaultActionDate());
  };

  const canSeePocketMoney = hasPermission('view_pocket_money');

  const handleAddRevenue = async () => {
    const fiscalTotal = revenueSplitByRate ? rateAmountsTotal(revenueRateAmounts) : parseFloat(fiscalRevenue) || 0;
    if (!fiscalTotal && !pocketMoney) {
      Alert.alert(t('common.error'), t('msg.enterAtLeastOne'));
      return;
    }
    if (isSubmittingForm) return;

    // By rate, the till total is the sum of the rates (the server adds them
    // up); else one total at one rate.
    const vatGroups = Object.entries(revenueRateAmounts)
      .map(([rate, value]) => ({ rate_percent: Number(rate), amount: Math.round((parseFloat(value) || 0) * 100) / 100 }))
      .filter((group) => group.amount > 0);
    setIsSubmittingForm(true);
    try {
      await api.createDailyRevenue({
        date: format(revenueDate, 'yyyy-MM-dd'),
        ...(revenueSplitByRate && vatGroups.length > 0
          ? { vat_groups: vatGroups }
          : { fiscal_revenue: fiscalTotal, vat_rate_percent: revenueVatRate, vat_groups: [] }),
        // Only someone who sees pocket money sets it - for anyone else the
        // field is hidden and the day keeps what it holds.
        ...(canSeePocketMoney ? { pocket_money: parseFloat(pocketMoney) || 0 } : {}),
        card_revenue: parseFloat(cardRevenue) || 0,
        location_id: revenueLocation,
      });
      if (revenueLocation) rememberLocation(revenueLocation);
      setRevenueLocationPick(undefined);
      setRevenueModalVisible(false);
      setFiscalRevenue('');
      setPocketMoney('');
      setCardRevenue('');
      showRevenueVat([], 20);
      setRevenueDate(getDefaultActionDate());
      loadData();
      Haptics.success();
      Toast.success(t('msg.revenueSaved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const submitExpense = async () => {
    setIsSubmittingForm(true);
    try {
      await api.createExpense({
        description: expenseDescription,
        amount: parseFloat(expenseAmount),
        date: format(expenseDate, 'yyyy-MM-dd'),
        location_id: expenseLocation,
      });
      if (expenseLocation) rememberLocation(expenseLocation);
      // Don't close modal, just clear fields and refresh list
      setExpenseDescription('');
      setExpenseAmount('');
      loadDayExpenses(expenseDate);
      loadData();
      Haptics.success();
      Toast.success(t('msg.expenseSaved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const handleAddExpense = () => {
    const missingDescription = !expenseDescription;
    const missingAmount = !expenseAmount;
    setExpenseDescriptionError(missingDescription);
    setExpenseAmountError(missingAmount);
    if (missingDescription || missingAmount) return;
    if (isSubmittingForm) return;

    // A soft nudge, not a block - catches the easy-to-make mistake of
    // re-adding a bill you already logged today (nothing here shows you
    // the OTHER days you might have missed instead - that's what the new
    // История screen is for), while still allowing two real same-day,
    // same-description expenses (e.g. two separate fuel stops) through.
    const normalizedNew = expenseDescription.trim().toLowerCase();
    const possibleDuplicate = dayExpenses.find((e) => e.description.trim().toLowerCase() === normalizedNew);
    if (possibleDuplicate) {
      Alert.alert(
        t('expenses.duplicateTitle'),
        t('expenses.duplicateMessage').replace('{description}', possibleDuplicate.description),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('expenses.addAnyway'), onPress: submitExpense },
        ]
      );
      return;
    }
    submitExpense();
  };

  const today = format(new Date(), "d MMMM yyyy 'г.'" , { locale: bg });
  // The day's actions, in the order a day goes: the till's revenue, an
  // expense, an invoice to a customer.
  const homeActions: { key: string; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void }[] = [
    ...(usesTill && hasPermission('add_revenue') ? [{
      key: 'revenue', label: t('home.dailyRevenue'), hint: t('home.actionRevenueHint'), icon: 'cash' as const, color: COLORS.success,
      onPress: () => { setRevenueDate(getDefaultActionDate()); setRevenueModalVisible(true); },
    }] : []),
    ...(hasPermission('add_expenses') ? [{
      key: 'expense', label: t('home.expenses'), hint: t('home.actionExpenseHint'), icon: 'remove-circle' as const, color: COLORS.warning,
      onPress: () => { setExpenseDate(getDefaultActionDate()); setExpenseModalVisible(true); },
    }] : []),
    ...(usesBilling && hasPermission('issue_invoices') ? [{
      key: 'invoice', label: t('home.actionInvoice'), hint: t('home.actionInvoiceHint'), icon: 'document-text' as const, color: COLORS.primary,
      onPress: () => router.push({ pathname: '/billing-documents', params: { new: 'invoice' } }),
    }] : []),
  ];
  // Under the boxes: the period's revenue (with a till, the till and
  // Джобче added up - for who sees both) and its expenses.
  const ledgerRows: { key: string; label: string; value: number }[] = [];
  if (summary) {
    if (usesTill) {
      if (summary.total_fiscal_revenue !== null && summary.total_pocket_money !== null) {
        ledgerRows.push({ key: 'till', label: t('home.revenueSum'), value: (summary.total_fiscal_revenue || 0) + (summary.total_pocket_money || 0) });
      }
    } else if (summary.total_income !== null) {
      ledgerRows.push({ key: 'income', label: t('home.totalIncome'), value: summary.total_income || 0 });
    }
    if (summary.total_expense !== null) {
      ledgerRows.push({ key: 'expense', label: t('home.totalExpenses'), value: summary.total_expense || 0 });
    }
  }
  // Which totals - and so which profit - this viewer sees; the "no
  // statistics at all" case has a note of its own further up.
  const restrictedNote = summary?.financial_visibility?.statistics === false
    ? null
    : restrictedDataNote(summary?.financial_visibility, t);

  // Home is hidden from the tab bar for a viewer without view_statistics
  // (see (tabs)/_layout.tsx's showHomeTab), but hiding a tab alone never
  // stops it being where login or a bookmarked "/" lands - this is the
  // other half of that: once auth has actually resolved (never redirect
  // off a still-loading permission set), send such a viewer straight to
  // Team instead, same destination the hidden tab bar icon would have
  // pointed at anyway.
  if (!authLoading && !hasPermission('view_statistics')) {
    return <Redirect href={showTeamTab ? '/(tabs)/team' : '/(tabs)/profile'} />;
  }

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <ScrollView
            style={styles.scrollView}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            {/* Home (Л3, Л4): what to do today, the main numbers, what needs
                attention. VAT, the average, payment kinds, the break-even and
                personal investments are in Statistics; the language and the
                days off in Account. */}
            <View style={styles.header}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.greeting}>{t('home.welcome')}</Text>
                <Text style={styles.date}>{today}</Text>
              </View>
              <View style={styles.headerActions}>
                <ScanCreditsBadge balance={home ? home.scan_credits : null} />
                <TouchableOpacity
                  style={styles.helpButton}
                  onPress={() => router.push('/help')}
                  accessibilityLabel={t('tutorial.helpButtonLabel')}
                  hitSlop={6}
                >
                  <Ionicons name="help" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* The day's actions first - each only for who may do it (a
                button whose only outcome is a refusal is not shown). */}
            {homeActions.length > 0 && (
              <View style={styles.actionsContainer}>
                {homeActions.map((action) => (
                  <TouchableOpacity
                    key={action.key}
                    style={[styles.actionButton, { backgroundColor: action.color }]}
                    onPress={action.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                  >
                    <Ionicons name={action.icon} size={22} color="white" />
                    <Text style={styles.actionButtonText} numberOfLines={2}>{action.label}</Text>
                    <Text style={styles.actionButtonHint} numberOfLines={2}>{action.hint}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <GettingStartedCard
              companyId={user?.company_id}
              showRevenue={usesTill && hasPermission('add_revenue')}
              showInvoice={hasPermission('manage_invoices')}
              showIssued={usesBilling && hasPermission('issue_invoices')}
              onAddRevenue={() => { setRevenueDate(getDefaultActionDate()); setRevenueModalVisible(true); }}
              status={home ? home.getting_started : null}
            />

            {!nothingYet && (
            <>
            <PeriodNavigator state={periodState} onChange={handlePeriodChange} />
            <PeriodSoFarNote summary={summary} />

            <Animated.View style={periodReveal.style}>
              {/* The main numbers: invoices, the till, Джобче, the profit -
                  and under them the period's revenue and expenses. */}
              <View style={styles.statsGrid}>
                {!summary ? (
                  <>
                    <SkeletonStat style={styles.statItem} />
                    <SkeletonStat style={styles.statItem} />
                    {usesTill && <SkeletonStat style={styles.statItem} />}
                    {usesTill && <SkeletonStat style={styles.statItem} />}
                  </>
                ) : (
                  <>
                    <View style={styles.statItem}>
                      {summary.invoice_count === null ? (
                        <LockedValue textStyle={styles.statValue} fakeText="14" iconSize={16} />
                      ) : (
                        <CountUp value={summary.invoice_count || 0} formatter={(n) => `${Math.round(n)}`} style={styles.statValue} />
                      )}
                      <Text style={styles.statLabel}>{t('home.invoices')}</Text>
                    </View>
                    {usesTill && (
                      <>
                        <View style={styles.statItem}>
                          {summary.total_fiscal_revenue === null ? (
                            <LockedValue textStyle={styles.statValue} fakeText="1240" iconSize={16} />
                          ) : (
                            <CountUp value={summary.total_fiscal_revenue || 0} formatter={(n) => formatMoney(n)} style={styles.statValue} />
                          )}
                          <Text style={styles.statLabel}>{t('home.fiscalRevenue')}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.statItem}
                          onPress={() => router.push('/pocket-money-history')}
                          disabled={summary.total_pocket_money === null}
                        >
                          {summary.total_pocket_money === null ? (
                            <LockedValue textStyle={styles.statValue} fakeText="95" iconSize={16} />
                          ) : (
                            <CountUp value={summary.total_pocket_money || 0} formatter={(n) => formatMoney(n)} style={styles.statValue} />
                          )}
                          <Text style={styles.statLabel}>{t('home.pocket')}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    <View style={[styles.statItem, { overflow: 'visible' }]}>
                      <CelebrationGlow trigger={celebrateProfit} onDone={() => setCelebrateProfit(false)} />
                      {summary.profit === null ? (
                        <LockedValue textStyle={styles.statValue} fakeText="380" iconSize={16} />
                      ) : (
                        <CountUp
                          value={summary.profit || 0}
                          formatter={(n) => formatMoney(n)}
                          style={[styles.statValue, { color: (summary.profit || 0) >= 0 ? COLORS.success : COLORS.danger }]}
                        />
                      )}
                      <Text style={styles.statLabel}>{t('home.profit')}</Text>
                    </View>
                    {ledgerRows.length > 0 && (
                      <View style={styles.ledger}>
                        {ledgerRows.map((row, index) => (
                          <View key={row.key} style={[styles.ledgerRow, index > 0 && styles.ledgerRowDivider]}>
                            <Text style={styles.ledgerLabel}>{row.label}</Text>
                            <Text style={styles.ledgerValue}>{formatMoney(row.value)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>
            </Animated.View>

            {summary?.financial_visibility?.statistics === false && (
              <View style={styles.restrictedNote}>
                <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.restrictedNoteText}>{t('visibility.noStatistics')}</Text>
              </View>
            )}
            {restrictedNote && (
              <View style={styles.restrictedNote}>
                <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.restrictedNoteText}>{restrictedNote}</Text>
              </View>
            )}
            </>
            )}

            {/* The assistant (Л8): ask about your numbers right here - the
                question opens its answer on the assistant's screen. */}
            {hasPermission('view_statistics') && (
              <View style={styles.askField}>
                <Ionicons name="chatbubbles-outline" size={18} color={COLORS.primary} />
                <TextInput
                  style={styles.askInput}
                  value={askText}
                  onChangeText={setAskText}
                  placeholder={t('home.askPlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  returnKeyType="send"
                  onSubmitEditing={askNumbers}
                />
                <TouchableOpacity onPress={askNumbers} accessibilityLabel={t('askMyNumbers.title')} hitSlop={8}>
                  <Ionicons name="arrow-forward-circle" size={26} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            )}

            {/* What needs attention: up to two, the rest behind "show more". */}
            <MorningBriefingCard signals={home ? home.signals ?? [] : null} />

            {/* A business that invoices: issued in the period, owed now,
                overdue (У2) - its "Фактура" is the action above. */}
            {showBilling && !nothingYet && (
              <BillingOverviewCard
                startDate={toApiDate(getPeriodBounds(periodState).start)}
                endDate={toApiDate(getPeriodBounds(periodState).end)}
                canIssue={false}
                overview={home ? home.billing_overview : null}
              />
            )}

            {/* "Лично тефтерче" is not on Home (Л4): it is in История и
                справки, and the day's review says when it needs a look. */}
      </ScrollView>

      {/* Revenue Modal */}
      <RevenueModal
        visible={revenueModalVisible}
        onClose={closeRevenueModal}
        date={revenueDate}
        onChangeDate={setRevenueDate}
        isDatePickerVisible={isRevenueDatePickerVisible}
        onOpenDatePicker={() => setRevenueDatePickerVisible(true)}
        onCloseDatePicker={() => setRevenueDatePickerVisible(false)}
        dateLocale={dateLocale}
        language={language}
        onCopyYesterday={handleCopyYesterday}
        copyingYesterday={copyingYesterday}
        onScanReport={handleScanReport}
        scanningReport={scanningReport}
        ocrAdditionNote={ocrAdditionNote}
        fiscalRevenue={fiscalRevenue}
        onChangeFiscalRevenue={setFiscalRevenue}
        cardRevenue={cardRevenue}
        onChangeCardRevenue={setCardRevenue}
        vatRate={revenueVatRate}
        onChangeVatRate={setRevenueVatRate}
        splitByRate={revenueSplitByRate}
        onToggleSplitByRate={toggleRevenueSplitByRate}
        rateAmounts={revenueRateAmounts}
        onChangeRateAmount={(rate, value) => setRevenueRateAmounts((prev) => ({ ...prev, [rate]: value }))}
        pocketMoney={pocketMoney}
        onChangePocketMoney={setPocketMoney}
        showPocketMoney={canSeePocketMoney}
        isSubmitting={isSubmittingForm}
        onSubmit={handleAddRevenue}
        onImportHistory={() => { closeRevenueModal(); setImportRevenueModalVisible(true); }}
        locationSlot={
          <LocationPicker
            value={revenueLocation}
            onChange={setRevenueLocationPick}
            noneLabel={t('locations.noneShared')}
            hint={revenueLocation === null ? t('locations.revenueNoneHint') : t('locations.revenueHint')}
          />
        }
      />

      {/* Expense Modal */}
      <ExpenseModal
        visible={expenseModalVisible}
        onClose={() => {
          setExpenseModalVisible(false);
          setExpenseDate(getDefaultActionDate());
          setExpenseLocationPick(undefined);
        }}
        onViewHistory={() => {
          setExpenseModalVisible(false);
          router.push('/off-book-expenses');
        }}
        date={expenseDate}
        onChangeDate={setExpenseDate}
        isDatePickerVisible={isExpenseDatePickerVisible}
        onOpenDatePicker={() => setExpenseDatePickerVisible(true)}
        onCloseDatePicker={() => setExpenseDatePickerVisible(false)}
        dateLocale={dateLocale}
        language={language}
        loadingExpenses={loadingExpenses}
        dayExpenses={dayExpenses}
        onDeleteExpense={handleDeleteExpense}
        description={expenseDescription}
        descriptionError={expenseDescriptionError}
        onChangeDescription={(v) => { setExpenseDescription(v); setExpenseDescriptionError(false); }}
        amount={expenseAmount}
        amountError={expenseAmountError}
        onChangeAmount={(v) => { setExpenseAmount(v); setExpenseAmountError(false); }}
        isSubmitting={isSubmittingForm}
        onSubmit={handleAddExpense}
        suggestions={expenseSuggestions}
        onImportHistory={() => {
          setExpenseModalVisible(false);
          setExpenseLocationPick(undefined);
          setImportExpenseModalVisible(true);
        }}
        onPickSuggestion={(s) => {
          setExpenseDescription(s.description);
          setExpenseAmount(String(s.amount));
          setExpenseDescriptionError(false);
          setExpenseAmountError(false);
        }}
        locationSlot={
          <LocationPicker value={expenseLocation} onChange={setExpenseLocationPick} noneLabel={t('locations.noneWhole')} />
        }
      />

      <ExcelImportModal
        visible={importRevenueModalVisible}
        onClose={() => setImportRevenueModalVisible(false)}
        entity="daily_revenue"
        title={t('home.importRevenueHistory')}
        fields={[
          { key: 'date', label: t('home.date') },
          { key: 'fiscal_revenue', label: t('home.fiscalRevenue'), format: (v) => `${formatMoney(Number(v))}` },
        ]}
        onImported={loadData}
      />

      <ExcelImportModal
        visible={importExpenseModalVisible}
        onClose={() => setImportExpenseModalVisible(false)}
        entity="expenses"
        title={t('home.importExpensesHistory')}
        fields={[
          { key: 'date', label: t('home.date') },
          { key: 'description', label: t('expenses.description') },
          { key: 'amount', label: t('invoices.total'), format: (v) => `${formatMoney(Number(v))}` },
        ]}
        onImported={loadData}
      />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helpButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  date: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statItem: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  askField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    paddingLeft: 14,
    paddingRight: 8,
    marginBottom: 16,
  },
  askInput: {
    flex: 1,
    color: 'white',
    fontSize: 14,
    paddingVertical: 12,
  },
  ledger: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  ledgerRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  ledgerLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
  ledgerValue: {
    fontSize: 15,
    fontWeight: '700',
    color: 'white',
  },
  restrictedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -12,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  restrictedNoteText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 14,
    gap: 2,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  actionButtonHint: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    textAlign: 'center',
  },
});
