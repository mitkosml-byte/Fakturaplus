import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Platform,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams, Redirect } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import { api } from '../../src/services/api';
import { Summary, DailyRevenue, NonInvoiceExpense, RoiAdviceResponse } from '../../src/types';
import { format, subDays } from 'date-fns';
import { bg } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import { useAuth } from '../../src/contexts/AuthContext';
import ExcelImportModal from '../../src/components/ExcelImportModal';
import { PeriodNavigator, PeriodSoFarNote } from '../../src/components/PeriodNavigator';
import { useSharedPeriod } from '../../src/utils/sharedPeriod';
import { ClosedDaysCalendar } from '../../src/components/ClosedDaysCalendar';
import { ScanCreditsBadge, useDirectionalReveal, CountUp, SkeletonStat, CelebrationGlow, PersonalWalletTeaser, MorningBriefingCard, LockedValue, LocationPicker } from '../../src/components';
import { useLocationChoice, useLocationsStore } from '../../src/stores/locationsStore';
import Animated from 'react-native-reanimated';
import { PeriodState, getPeriodBounds, toApiDate } from '../../src/utils/periodRange';
import { COLORS } from '../../src/theme/colors';
import { restrictedDataNote } from '../../src/utils/visibilityNote';
import { PersonalExpenseModal } from '../../src/components/home/PersonalExpenseModal';
import { RevenueModal, rateAmountsTotal } from '../../src/components/home/RevenueModal';
import type { VatGroupAmount, ZReportResult } from '../../src/types';
import { ExpenseModal } from '../../src/components/home/ExpenseModal';
import { BillingOverviewCard } from '../../src/components/home/BillingOverviewCard';
import { BreakEvenCard } from '../../src/components/home/BreakEvenCard';
import { pickScanImage } from '../../src/utils/scanImage';
import { useModules } from '../../src/stores/modulesStore';
import { useShowTeamTab } from '../../src/hooks/useTeamTab';
import { getDescriptionSuggestions } from '../../src/utils/expenseSuggestions';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function HomeScreen() {
  const { t, dateLocale } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { isOwner, hasPermission, isLoading: authLoading } = useAuth();
  // Home shows what the business uses (У3): a business without a till sees
  // no till revenue, average per day or pocket money; one that invoices
  // sees what it issued and what customers owe, with "+ Фактура".
  const { uses } = useModules();
  const usesTill = uses('till');
  const usesBilling = uses('billing');
  const usesWallet = uses('wallet');
  const showTeamTab = useShowTeamTab();
  const router = useRouter();
  const ocrParams = useLocalSearchParams<{ ocrDate?: string; ocrFiscalRevenue?: string; ocrVatRate?: string; revenueDate?: string }>();

  const [summary, setSummary] = useState<Summary | null>(null);
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
  const [personalExpenseModalVisible, setPersonalExpenseModalVisible] = useState(false);
  
  // ROI state (owner only)
  const [roiData, setRoiData] = useState<any>(null);
  // AI advice on the ROI numbers: shown when already kept for these numbers,
  // otherwise asked for with a tap (it costs a model call, so never on its own).
  const [roiAdvice, setRoiAdvice] = useState<RoiAdviceResponse | null>(null);
  const [roiAdviceLoading, setRoiAdviceLoading] = useState(false);
  const [loadingRoi, setLoadingRoi] = useState(false);
  
  // Personal expense form
  const [personalAmount, setPersonalAmount] = useState('');
  const [personalDescription, setPersonalDescription] = useState('');
  const [personalType, setPersonalType] = useState('recurring');
  const [personalCategory, setPersonalCategory] = useState('other');
  const [personalAmountError, setPersonalAmountError] = useState(false);
  const [personalDescriptionError, setPersonalDescriptionError] = useState(false);
  
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
  // Same idea for personal expenses - getPersonalExpenses() with no
  // month/year returns the owner's full history, so this needs no new
  // backend endpoint either.
  const [personalSuggestionSource, setPersonalSuggestionSource] = useState<
    { description: string; amount: number; date: string }[]
  >([]);
  
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
          const summaryData = await api.getSummary({ start_date, end_date });
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
  }, [periodState]);

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
  // below - MorningBriefingCard, PersonalWalletTeaser) stayed stuck on its
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
          t('home.ocrAdditionNote').replace('{amount}', pending.amount.toFixed(2))
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

  useEffect(() => {
    if (!personalExpenseModalVisible || personalSuggestionSource.length > 0) return;
    api.getPersonalExpenses()
      .then(({ personal_expenses }) =>
        setPersonalSuggestionSource(
          personal_expenses.map((p) => ({ description: p.description, amount: p.amount, date: p.created_at }))
        )
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalExpenseModalVisible]);

  const personalSuggestions = useMemo(
    () => getDescriptionSuggestions(personalSuggestionSource),
    [personalSuggestionSource]
  );

  // Load ROI/personal-investments data - visible to the owner and to any
  // delegated member the owner has granted view_personal_investments.
  // Follows the same period navigator as the rest of the dashboard (via the
  // calendar month its selected period falls in - the ROI endpoint and its
  // AI insights are inherently month-shaped, e.g. "wait ~45 days of data"),
  // instead of always silently defaulting to the current month regardless
  // of what period the dashboard above is actually showing - that mismatch
  // is exactly what made this card look "frozen" at zero once a new month
  // started with no personal expenses logged yet, even though September's
  // real data was still sitting right there, one period-back away.
  const canViewPersonalInvestments = hasPermission('view_personal_investments');
  const loadRoiData = useCallback(async () => {
    if (!canViewPersonalInvestments) return;

    setLoadingRoi(true);
    try {
      const periodStart = getPeriodBounds(periodState).start;
      const roiPeriod = { month: periodStart.getMonth() + 1, year: periodStart.getFullYear(), language };
      const data = await api.getROIAnalysis(roiPeriod);
      setRoiData(data);
      setRoiAdvice(null);
      if (data.analysis?.payback) {
        api.getRoiAdvice({ ...roiPeriod, generate: false }).then(setRoiAdvice).catch(() => setRoiAdvice(null));
      }
    } catch (error) {
      console.error('Error loading ROI:', error);
      setRoiData(null);
    } finally {
      setLoadingRoi(false);
    }
  }, [canViewPersonalInvestments, periodState, language]);

  const askRoiAdvice = async () => {
    const periodStart = getPeriodBounds(periodState).start;
    setRoiAdviceLoading(true);
    try {
      setRoiAdvice(await api.getRoiAdvice({
        month: periodStart.getMonth() + 1, year: periodStart.getFullYear(), language, generate: true,
      }));
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || '');
    } finally {
      setRoiAdviceLoading(false);
    }
  };

  // authLoading in the deps list: same auth-readiness race as loadData
  // above - see its comment. useFocusEffect re-runs its effect whenever
  // this memoized callback's identity changes while still focused, so
  // this alone both skips the doomed first call and retries once
  // checkAuth() actually finishes.
  useFocusEffect(
    useCallback(() => {
      if (!authLoading && canViewPersonalInvestments) {
        loadRoiData();
      }
    }, [canViewPersonalInvestments, loadRoiData, authLoading])
  );

  // Create personal expense
  const handleCreatePersonalExpense = async () => {
    const amount = parseFloat(personalAmount);
    const invalidAmount = isNaN(amount) || amount <= 0;
    const missingDescription = !personalDescription.trim();
    setPersonalAmountError(invalidAmount);
    setPersonalDescriptionError(missingDescription);
    if (invalidAmount || missingDescription) return;
    if (isSubmittingForm) return;

    // Tagged to whichever period the dashboard above is currently showing,
    // not necessarily today's real calendar month - otherwise adding an
    // expense while looking back at a past period would silently file it
    // under the current month instead, making the card you're looking at
    // never update (exactly what made this section look "frozen").
    const periodStart = getPeriodBounds(periodState).start;
    setIsSubmittingForm(true);
    try {
      await api.createPersonalExpense({
        amount,
        description: personalDescription.trim(),
        expense_type: personalType,
        category: personalCategory,
        period_month: periodStart.getMonth() + 1,
        period_year: periodStart.getFullYear(),
      });

      Haptics.success();
      Toast.success(t('personal.created'));
      setPersonalAmount('');
      setPersonalDescription('');
      setPersonalType('recurring');
      setPersonalCategory('other');
      setPersonalExpenseModalVisible(false);
      loadRoiData();
    } catch (error) {
      Alert.alert(t('common.error'), t('common.operationFailed'));
    } finally {
      setIsSubmittingForm(false);
    }
  };

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
  // Average per day with revenue entered (backend period pace): a day
  // nobody entered, a closed day or a day still to come is not a day of the
  // average. While the period runs, its expected end comes with it.
  const pace = summary?.pace ?? null;
  const avgDailyTurnover = pace?.avg_per_revenue_day ?? 0;
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
            {/* Header - greeting and the icon row stack vertically instead
                of sharing one row, since three icons (scan credits, language,
                receipt) squeezed next to the large greeting text crowded
                together on narrower phone screens. */}
            <View style={styles.header}>
              <View>
                <Text style={styles.greeting}>{t('home.welcome')}</Text>
                <Text style={styles.date}>{today}</Text>
              </View>
              <View style={styles.headerIconsRow}>
                <ScanCreditsBadge />
                <TouchableOpacity
                  style={styles.headerIcon}
                  onPress={() => { Haptics.success(); setLanguage(language === 'bg' ? 'en' : 'bg'); }}
                  accessibilityLabel={t('home.switchLanguage')}
                >
                  <Text style={styles.languageToggleText}>{language === 'bg' ? 'BG' : 'EN'}</Text>
                </TouchableOpacity>
                <View style={styles.headerIcon}>
                  <Ionicons name="receipt" size={28} color={COLORS.primary} />
                </View>
              </View>
            </View>

            <MorningBriefingCard refreshSignal={summary} />

            <PeriodNavigator state={periodState} onChange={handlePeriodChange} />
            <PeriodSoFarNote summary={summary} />

            <Animated.View style={periodReveal.style}>
            {/* Summary Cards - skeletons stand in until the first real
                summary lands, so these never flash "0.00 €" for data that
                just hasn't arrived yet. Once it lands, a card whose field
                came back null (viewer lacks view_statistics) shows a
                blurred placeholder instead of either the real figure or a
                bare lock icon - nothing sensitive sits behind the blur,
                the backend already redacted the real number to null. */}
            {!summary ? (
              <>
                <View style={styles.summaryContainer}>
                  <SkeletonStat style={[styles.summaryCard, styles.incomeCard]} />
                  <SkeletonStat style={[styles.summaryCard, styles.expenseCard]} />
                </View>
                {usesTill && (
                <View style={styles.summaryContainer}>
                  <SkeletonStat style={[styles.summaryCard, styles.cashCard]} />
                  <SkeletonStat style={[styles.summaryCard, styles.cardCard]} />
                </View>
                )}
              </>
            ) : (
            <>
            <View style={styles.summaryContainer}>
              <View style={[styles.summaryCard, styles.incomeCard]}>
                <View style={styles.cardIcon}>
                  <Ionicons name="trending-up" size={24} color={COLORS.success} />
                </View>
                <Text style={styles.cardLabel}>{t('home.totalIncome')}</Text>
                {summary.total_income === null ? (
                  <LockedValue textStyle={[styles.cardValue, { color: COLORS.success }]} fakeText="1 240.00 €" />
                ) : (
                  <CountUp
                    value={summary.total_income || 0}
                    formatter={(n) => `${n.toFixed(2)} €`}
                    style={[styles.cardValue, { color: COLORS.success }]}
                  />
                )}
                {/* Invoices issued to customers are income of their day. */}
                {!!summary.total_issued_invoices && (
                  <Text style={styles.cardIssuedNote}>
                    {t('stats.ofWhichIssuedInvoices').replace('{amount}', summary.total_issued_invoices.toFixed(2))}
                  </Text>
                )}
              </View>

              <View style={[styles.summaryCard, styles.expenseCard]}>
                <View style={styles.cardIcon}>
                  <Ionicons name="trending-down" size={24} color={COLORS.danger} />
            </View>
            <Text style={styles.cardLabel}>{t('home.totalExpenses')}</Text>
            {summary.total_expense === null ? (
              <LockedValue textStyle={[styles.cardValue, { color: COLORS.danger }]} fakeText="860.00 €" />
            ) : (
              <CountUp
                value={summary.total_expense || 0}
                formatter={(n) => `${n.toFixed(2)} €`}
                style={[styles.cardValue, { color: COLORS.danger }]}
              />
            )}
          </View>
        </View>

        {/* How the income came: cash, card and - for invoices paid by bank - bank.
            Cash and card are the till's - shown without one only if money came so. */}
        {(usesTill || (summary.total_cash_revenue || 0) > 0 || (summary.total_card_revenue || 0) > 0) && (
        <View style={styles.summaryContainer}>
          <View style={[styles.summaryCard, styles.cashCard]}>
            <View style={styles.cardIcon}>
              <Ionicons name="cash-outline" size={24} color={COLORS.success} />
            </View>
            <Text style={styles.cardLabel}>{t('home.cashRevenue')}</Text>
            {summary.total_cash_revenue === null ? (
              <LockedValue textStyle={[styles.cardValue, { color: COLORS.success }]} fakeText="430.00 €" />
            ) : (
              <CountUp
                value={summary.total_cash_revenue || 0}
                formatter={(n) => `${n.toFixed(2)} €`}
                style={[styles.cardValue, { color: COLORS.success }]}
              />
            )}
          </View>

          <View style={[styles.summaryCard, styles.cardCard]}>
            <View style={styles.cardIcon}>
              <Ionicons name="card-outline" size={24} color={COLORS.info} />
            </View>
            <Text style={styles.cardLabel}>{t('home.cardRevenue')}</Text>
            {summary.total_card_revenue === null ? (
              <LockedValue textStyle={[styles.cardValue, { color: COLORS.info }]} fakeText="810.00 €" />
            ) : (
              <CountUp
                value={summary.total_card_revenue || 0}
                formatter={(n) => `${n.toFixed(2)} €`}
                style={[styles.cardValue, { color: COLORS.info }]}
              />
            )}
          </View>
        </View>
        )}
        {(summary.total_bank_revenue || 0) > 0 && (
          <View style={styles.summaryContainer}>
            <View style={[styles.summaryCard, styles.bankCard]}>
              <View style={styles.cardIcon}>
                <Ionicons name="business-outline" size={24} color={COLORS.primary} />
              </View>
              <Text style={styles.cardLabel}>{t('home.bankRevenue')}</Text>
              <CountUp
                value={summary.total_bank_revenue || 0}
                formatter={(n) => `${n.toFixed(2)} €`}
                style={[styles.cardValue, { color: COLORS.primary }]}
              />
            </View>
          </View>
        )}
            </>
            )}

        {/* Not registered for VAT: no VAT to pay or deduct */}
        {summary?.vat_registered !== false && (
        <>
        {/* VAT Card */}
        <View style={styles.vatCard}>
          <View style={styles.vatHeader}>
            <Ionicons name="calculator" size={24} color={COLORS.primary} />
            <Text style={styles.vatTitle}>{t('home.vatToPay')}</Text>
          </View>
          {summary?.vat_to_pay === null ? (
            <LockedValue textStyle={styles.vatValue} fakeText="124.50 €" iconSize={18} />
          ) : (
            <CountUp
              value={summary?.vat_to_pay || 0}
              formatter={(n) => `${n.toFixed(2)} €`}
              style={[styles.vatValue, { color: (summary?.vat_to_pay || 0) >= 0 ? COLORS.danger : COLORS.success }]}
            />
          )}
          <View style={styles.vatDetails}>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>{t('stats.vatFromSales')}:</Text>
              {summary?.fiscal_vat === null ? (
                <LockedValue textStyle={styles.vatDetailValue} fakeText="210.40 €" iconSize={11} />
              ) : (
                <Text style={styles.vatDetailValue}>{summary?.fiscal_vat?.toFixed(2) || '0.00'} €</Text>
              )}
            </View>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>{t('stats.vatCredit')}:</Text>
              {summary?.total_invoice_vat === null ? (
                <LockedValue textStyle={styles.vatDetailValue} fakeText="85.90 €" iconSize={11} />
              ) : (
                <Text style={styles.vatDetailValue}>-{summary?.total_invoice_vat?.toFixed(2) || '0.00'} €</Text>
              )}
            </View>
          </View>
        </View>
        </>
        )}
            </Animated.View>

        {/* A business that invoices: issued in the period, owed now,
            overdue - and "+ Фактура" (У2, У3). */}
        {usesBilling && (hasPermission('add_revenue') || hasPermission('issue_invoices')) && (
          <BillingOverviewCard
            startDate={toApiDate(getPeriodBounds(periodState).start)}
            endDate={toApiDate(getPeriodBounds(periodState).end)}
            canIssue={hasPermission('issue_invoices')}
            refreshSignal={summary}
          />
        )}

        {/* Unpaid supplier invoices reminder - company-wide, not scoped to
            this month, since money owed from any past period is still owed */}
        {(summary?.unpaid_invoice_count || 0) > 0 && (
          <TouchableOpacity
            style={[styles.unpaidCard, (summary?.overdue_invoice_count || 0) > 0 && styles.unpaidCardOverdue]}
            onPress={() => router.push({ pathname: '/(tabs)/invoices', params: { paymentFilter: 'unpaid' } })}
            activeOpacity={0.8}
          >
            <View style={styles.unpaidHeader}>
              <Ionicons
                name={(summary?.overdue_invoice_count || 0) > 0 ? 'alert-circle' : 'time-outline'}
                size={24}
                color={(summary?.overdue_invoice_count || 0) > 0 ? COLORS.danger : COLORS.warning}
              />
              <Text style={styles.unpaidTitle}>{t('home.unpaidInvoices')}</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </View>
            <CountUp
              value={summary?.total_unpaid_amount || 0}
              formatter={(n) => `${n.toFixed(2)} €`}
              style={[styles.unpaidValue, { color: (summary?.overdue_invoice_count || 0) > 0 ? COLORS.danger : COLORS.warning }]}
            />
            <Text style={styles.unpaidSubtitle}>
              {summary?.unpaid_invoice_count} {t('home.unpaidInvoicesCount')}
              {(summary?.overdue_invoice_count || 0) > 0
                ? ` · ${summary?.overdue_invoice_count} ${t('home.overdueInvoicesCount')}`
                : ''}
            </Text>
          </TouchableOpacity>
        )}

        {/* The day's target: what the month has to sell to end at zero (Н5) -
            for whoever sees the profit. */}
        {hasPermission('view_profit') && (
          <BreakEvenCard canManageBudget={hasPermission('manage_budget')} refreshSignal={summary} />
        )}

        {/* Average Daily Turnover - taps through to the same stat in Statistics,
            broken down by period, for deeper business analysis. The till's:
            the average of the days it was entered. */}
        {usesTill && (
        <TouchableOpacity
          style={styles.avgTurnoverCard}
          onPress={() => router.push('/(tabs)/stats')}
          activeOpacity={0.8}
        >
          <View style={styles.avgTurnoverHeader}>
            <Ionicons name="speedometer" size={24} color={COLORS.info} />
            <Text style={styles.avgTurnoverTitle}>{t('home.avgDailyTurnover')}</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </View>
          {summary && summary.total_income === null ? (
            <LockedValue textStyle={styles.avgTurnoverValue} fakeText="61.30 €" iconSize={18} />
          ) : (
            <CountUp
              value={avgDailyTurnover}
              formatter={(n) => `${(Number.isFinite(n) ? n : 0).toFixed(2)} €`}
              style={styles.avgTurnoverValue}
            />
          )}
          <Text style={styles.avgTurnoverSubtitle}>
            {t('home.avgDailyTurnoverSubtitle').replace('{days}', String(pace?.revenue_days ?? 0))}
          </Text>
          {pace?.is_current && pace.expected_income !== null && (
            <Text style={styles.avgTurnoverSubtitle}>
              {t('home.expectedPeriodEnd').replace('{amount}', `${pace.expected_income.toFixed(2)} €`)}
            </Text>
          )}
        </TouchableOpacity>
        )}

        {summary?.financial_visibility?.statistics === false && (
          <View style={styles.restrictedNote}>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.restrictedNoteText}>{t('visibility.noStatistics')}</Text>
          </View>
        )}

        {/* Closed/open-days calendar - embedded here (collapsed by default)
            so it's regularly filled in without needing a trip to Profile,
            since it directly feeds the average-turnover figure above. */}
        {usesTill && hasPermission('manage_company') && (
          <View style={{ marginBottom: 16 }}>
            <ClosedDaysCalendar collapsible />
          </View>
        )}

        {/* Personal wallet teaser - collapsed by default, see component for
            why it's gated here rather than inside it. */}
        {usesWallet && hasPermission('view_personal_wallet') && <PersonalWalletTeaser refreshSignal={summary} />}

        {/* Stats Overview */}
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            {summary && summary.invoice_count === null ? (
              <LockedValue textStyle={styles.statValue} fakeText="14" iconSize={16} />
            ) : (
              <CountUp value={summary?.invoice_count || 0} formatter={(n) => `${Math.round(n)}`} style={styles.statValue} />
            )}
            <Text style={styles.statLabel}>{t('home.invoices')}</Text>
          </View>
          {usesTill && (
          <>
          <View style={styles.statItem}>
            {summary && summary.total_fiscal_revenue === null ? (
              <LockedValue textStyle={styles.statValue} fakeText="1240" iconSize={16} />
            ) : (
              <CountUp value={summary?.total_fiscal_revenue || 0} formatter={(n) => `${n.toFixed(0)}`} style={styles.statValue} />
            )}
            <Text style={styles.statLabel}>{t('home.fiscalRevenue')}</Text>
          </View>
          <TouchableOpacity
            style={styles.statItem}
            onPress={() => router.push('/pocket-money-history')}
            disabled={summary?.total_pocket_money === null}
          >
            {summary && summary.total_pocket_money === null ? (
              <LockedValue textStyle={styles.statValue} fakeText="95" iconSize={16} />
            ) : (
              <CountUp value={summary?.total_pocket_money || 0} formatter={(n) => `${n.toFixed(0)}`} style={styles.statValue} />
            )}
            <Text style={styles.statLabel}>{t('home.pocket')}</Text>
          </TouchableOpacity>
          </>
          )}
          <View style={[styles.statItem, { overflow: 'visible' }]}>
            <CelebrationGlow trigger={celebrateProfit} onDone={() => setCelebrateProfit(false)} />
            {summary && summary.profit === null ? (
              <LockedValue textStyle={styles.statValue} fakeText="380" iconSize={16} />
            ) : (
              <CountUp
                value={summary?.profit || 0}
                formatter={(n) => `${n.toFixed(0)}`}
                style={[styles.statValue, { color: (summary?.profit || 0) >= 0 ? COLORS.success : COLORS.danger }]}
              />
            )}
            <Text style={styles.statLabel}>{t('home.profit')}</Text>
          </View>
          {/* The till's and Джобче's revenue added up, for the period shown -
              a day's turnover when the period is a day. Only for who sees
              both (else it would only repeat the till's box). */}
          {usesTill && summary && summary.total_fiscal_revenue !== null && summary.total_pocket_money !== null && (
            <View style={styles.revenueSumRow}>
              <Text style={styles.revenueSumLabel}>{t('home.revenueSum')}</Text>
              <Text style={styles.revenueSumValue}>
                {((summary.total_fiscal_revenue || 0) + (summary.total_pocket_money || 0)).toFixed(2)} €
              </Text>
            </View>
          )}
        </View>

        {restrictedNote && (
          <View style={styles.restrictedNote}>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.restrictedNoteText}>{restrictedNote}</Text>
          </View>
        )}

        {/* Action Buttons - each gated on its own permission (an owner can
            fine-tune these independently per member via the permissions
            checklist), rather than showing a button whose only possible
            outcome is a permission-denied error from the backend. */}
        {((usesTill && hasPermission('add_revenue')) || hasPermission('add_expenses')) && (
          <View style={styles.actionsContainer}>
            {usesTill && hasPermission('add_revenue') && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: COLORS.success }]}
                onPress={() => {
                  setRevenueDate(getDefaultActionDate());
                  setRevenueModalVisible(true);
                }}
              >
                <Ionicons name="cash" size={24} color="white" />
                <Text style={styles.actionButtonText}>{t('home.dailyRevenue')}</Text>
              </TouchableOpacity>
            )}

            {hasPermission('add_expenses') && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: COLORS.warning }]}
                onPress={() => {
                  setExpenseDate(getDefaultActionDate());
                  setExpenseModalVisible(true);
                }}
              >
                <Ionicons name="remove-circle" size={24} color="white" />
                <Text style={styles.actionButtonText}>{t('home.expenses')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {((usesTill && hasPermission('add_revenue')) || hasPermission('add_expenses')) && (
          <View style={styles.importLinksRow}>
            {usesTill && hasPermission('add_revenue') && (
              <TouchableOpacity style={styles.importLink} onPress={() => setImportRevenueModalVisible(true)}>
                <Ionicons name="cloud-upload-outline" size={14} color={COLORS.primary} />
                <Text style={styles.importLinkText}>{t('home.importRevenueHistory')}</Text>
              </TouchableOpacity>
            )}
            {hasPermission('add_expenses') && (
              <TouchableOpacity style={styles.importLink} onPress={() => setImportExpenseModalVisible(true)}>
                <Ionicons name="cloud-upload-outline" size={14} color={COLORS.primary} />
                <Text style={styles.importLinkText}>{t('home.importExpensesHistory')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Personal Expenses & ROI Section - visible to anyone with
            view_personal_investments; adding a personal expense stays an
            owner-only write action regardless. */}
        {usesWallet && canViewPersonalInvestments && (
          <View style={styles.roiSection}>
            <View style={styles.roiHeader}>
              <View style={styles.roiTitleRow}>
                <Ionicons name="person-circle" size={24} color={COLORS.primary} />
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.roiTitle} numberOfLines={1}>{t('personal.title')}</Text>
                  <Text style={styles.roiPeriodLabel} numberOfLines={1}>
                    {format(getPeriodBounds(periodState).start, 'LLLL yyyy', { locale: dateLocale })}
                  </Text>
                </View>
              </View>
              <View style={styles.roiActionsRow}>
                <TouchableOpacity
                  style={styles.historyPersonalButton}
                  onPress={() => router.push('/personal-expenses')}
                >
                  <Ionicons name="time-outline" size={18} color={COLORS.textSecondary} />
                  <Text style={styles.historyPersonalText}>{t('personal.history')}</Text>
                </TouchableOpacity>
                {isOwner && (
                  <TouchableOpacity
                    style={styles.addPersonalButton}
                    onPress={() => setPersonalExpenseModalVisible(true)}
                  >
                    <Ionicons name="add-circle" size={20} color={COLORS.primary} />
                    <Text style={styles.addPersonalText}>{t('personal.addExpense')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {loadingRoi ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 20 }} />
            ) : roiData ? (
              <>
                {/* ROI Stats */}
                <View style={styles.roiStats}>
                  <View style={styles.roiStatItem}>
                    <Text style={styles.roiStatLabel}>{t('roi.totalInvestment')}</Text>
                    <Text style={[styles.roiStatValue, { color: COLORS.danger }]}>
                      {roiData.total_personal_investment.toFixed(2)} €
                    </Text>
                  </View>
                  <View style={styles.roiStatItem}>
                    <Text style={styles.roiStatLabel}>{t('roi.totalProfit')}</Text>
                    {roiData.total_profit === null ? (
                      <Ionicons name="lock-closed" size={18} color={COLORS.textMuted} style={{ marginBottom: 4 }} />
                    ) : (
                      <Text style={[styles.roiStatValue, { color: roiData.total_profit >= 0 ? COLORS.success : COLORS.danger }]}>
                        {roiData.total_profit.toFixed(2)} €
                      </Text>
                    )}
                  </View>
                  <View style={styles.roiStatItem}>
                    <Text style={styles.roiStatLabel}>{t('roi.roiPercent')}</Text>
                    {roiData.roi_percent === null ? (
                      <Ionicons name="lock-closed" size={18} color={COLORS.textMuted} style={{ marginBottom: 4 }} />
                    ) : (
                      <Text style={[styles.roiStatValue, { color: roiData.roi_percent >= 0 ? COLORS.success : COLORS.danger }]}>
                        {roiData.roi_percent.toFixed(1)}%
                      </Text>
                    )}
                  </View>
                </View>

                {/* ROI Status Indicator - hidden entirely without view_profit,
                    since a covered/not-covered verdict is itself derived from
                    the profit figure this viewer isn't allowed to see. */}
                {roiData.investment_covered !== null && (
                  <View style={[
                    styles.roiStatus,
                    { backgroundColor: roiData.investment_covered ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
                  ]}>
                    <Ionicons
                      name={roiData.investment_covered ? "checkmark-circle" : "alert-circle"}
                      size={20}
                      color={roiData.investment_covered ? COLORS.success : COLORS.danger}
                    />
                    <Text style={[
                      styles.roiStatusText,
                      { color: roiData.investment_covered ? COLORS.success : COLORS.danger }
                    ]}>
                      {roiData.investment_covered ? t('roi.investmentCovered') : t('roi.investmentNotCovered')}
                    </Text>
                  </View>
                )}

                {/* What the business gives back: payback over the last months,
                    what moved profit, what can be done (each opening its place),
                    and AI advice on those numbers when asked for. */}
                {roiData.analysis ? (
                  <View style={styles.aiInsights}>
                    <Text style={styles.aiInsightsTitle}>{t('roi.analysisTitle')}</Text>
                    {roiData.analysis.payback && (
                      <Text style={styles.roiPaybackText}>{roiData.analysis.payback.text}</Text>
                    )}
                    {roiData.analysis.month && (
                      <Text style={styles.aiInsightText}>{roiData.analysis.month.text}</Text>
                    )}
                    {roiData.analysis.movers.length > 0 && (
                      <>
                        <Text style={styles.roiSubTitle}>{t('roi.whatMoved')}</Text>
                        {roiData.analysis.movers.map((mover: any) => (
                          <View key={`${mover.kind}-${mover.label}`} style={styles.roiLine}>
                            <Ionicons
                              name={mover.profit_effect >= 0 ? 'arrow-up-circle' : 'arrow-down-circle'}
                              size={16}
                              color={mover.profit_effect >= 0 ? COLORS.success : COLORS.danger}
                            />
                            <Text style={[styles.aiInsightText, styles.roiLineText]}>{mover.text}</Text>
                          </View>
                        ))}
                      </>
                    )}
                    {roiData.analysis.actions.length > 0 && (
                      <>
                        <Text style={styles.roiSubTitle}>{t('roi.whatToDo')}</Text>
                        {roiData.analysis.actions.map((action: any) => (
                          <TouchableOpacity
                            key={action.kind}
                            style={styles.roiAction}
                            onPress={() => router.push(action.route as any)}
                          >
                            <Ionicons name="bulb-outline" size={16} color={COLORS.warning} />
                            <Text style={[styles.aiInsightText, styles.roiLineText]}>{action.text}</Text>
                            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                          </TouchableOpacity>
                        ))}
                      </>
                    )}
                    {roiData.analysis.notes.map((note: string) => (
                      <Text key={note} style={styles.roiNote}>{note}</Text>
                    ))}
                    {roiAdvice?.available && (roiAdvice.advice ? (
                      <View style={styles.roiAdviceBox}>
                        <View style={styles.roiLine}>
                          <Ionicons name="sparkles" size={14} color={COLORS.primary} />
                          <Text style={styles.roiAdviceTitle}>{t('roi.aiAdvice')}</Text>
                        </View>
                        <Text style={styles.roiAdviceHeadline}>{roiAdvice.advice.headline}</Text>
                        {roiAdvice.advice.points.map((point) => (
                          <Text key={point} style={styles.aiInsightText}>• {point}</Text>
                        ))}
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.roiAdviceButton}
                        onPress={askRoiAdvice}
                        disabled={roiAdviceLoading}
                      >
                        {roiAdviceLoading ? (
                          <ActivityIndicator size="small" color={COLORS.primary} />
                        ) : (
                          <>
                            <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                            <View style={{ flexShrink: 1 }}>
                              <Text style={styles.roiAdviceButtonText}>{t('roi.askAdvice')}</Text>
                              <Text style={styles.roiNote}>{t('roi.askAdviceHint')}</Text>
                            </View>
                          </>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : roiData.ai_insights && roiData.ai_insights.length > 0 && (
                  <View style={styles.aiInsights}>
                    <Text style={styles.aiInsightsTitle}>{t('roi.aiInsights')}</Text>
                    {roiData.ai_insights.map((insight: string, index: number) => (
                      <Text key={index} style={styles.aiInsightText}>{insight}</Text>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noRoiData}>
                <Text style={styles.noRoiDataText}>{t('roi.noData')}</Text>
                <Text style={styles.noRoiDataSubtext}>{t('personal.subtitle')}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Personal Expense Modal (Owner Only) */}
      {isOwner && (
        <PersonalExpenseModal
          visible={personalExpenseModalVisible}
          onClose={() => setPersonalExpenseModalVisible(false)}
          periodLabel={format(getPeriodBounds(periodState).start, 'LLLL yyyy', { locale: dateLocale })}
          amount={personalAmount}
          amountError={personalAmountError}
          onChangeAmount={(v) => { setPersonalAmount(v); setPersonalAmountError(false); }}
          description={personalDescription}
          descriptionError={personalDescriptionError}
          onChangeDescription={(v) => { setPersonalDescription(v); setPersonalDescriptionError(false); }}
          type={personalType}
          onChangeType={setPersonalType}
          category={personalCategory}
          onChangeCategory={setPersonalCategory}
          isSubmitting={isSubmittingForm}
          onSubmit={handleCreatePersonalExpense}
          language={language}
          suggestions={personalSuggestions}
          onPickSuggestion={(s) => {
            setPersonalDescription(s.description);
            setPersonalAmount(String(s.amount));
            setPersonalDescriptionError(false);
            setPersonalAmountError(false);
          }}
        />
      )}

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
          { key: 'fiscal_revenue', label: t('home.fiscalRevenue'), format: (v) => `${Number(v).toFixed(2)} €` },
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
          { key: 'amount', label: t('invoices.total'), format: (v) => `${Number(v).toFixed(2)} €` },
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
    marginBottom: 24,
  },
  headerIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 10,
    marginTop: 12,
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
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
  },
  incomeCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  expenseCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.danger,
  },
  cashCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  cardCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.info,
  },
  bankCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  unpaidCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.warning,
  },
  unpaidCardOverdue: {
    borderColor: COLORS.danger,
  },
  unpaidHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  unpaidTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginLeft: 12,
    flex: 1,
  },
  unpaidValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  unpaidSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardIssuedNote: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  cardLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  vatCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  vatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  vatTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginLeft: 12,
  },
  vatValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  vatDetails: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  vatDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  vatDetailLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  vatDetailValue: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  avgTurnoverCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.info,
  },
  avgTurnoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avgTurnoverTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginLeft: 12,
    flex: 1,
  },
  avgTurnoverValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.info,
    marginBottom: 4,
  },
  avgTurnoverSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
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
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  revenueSumRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  revenueSumLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
  revenueSumValue: {
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
    gap: 12,
    marginBottom: 32,
  },
  importLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: -20,
    marginBottom: 24,
  },
  importLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  importLinkText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  // Personal Expenses & ROI Styles
  roiSection: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  roiHeader: {
    marginBottom: 16,
    gap: 10,
  },
  roiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roiTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
    flexShrink: 1,
  },
  roiPeriodLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    textTransform: 'capitalize',
    marginTop: 1,
  },
  roiActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addPersonalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 8,
    flexShrink: 1,
  },
  addPersonalText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  historyPersonalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderRadius: 8,
    flexShrink: 1,
  },
  historyPersonalText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  roiStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  roiStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  roiStatLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  roiStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  roiStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  roiStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  aiInsights: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 10,
    padding: 14,
  },
  aiInsightsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 10,
  },
  aiInsightText: {
    fontSize: 13,
    color: COLORS.textSubtle,
    lineHeight: 20,
    marginBottom: 6,
  },
  roiPaybackText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
    lineHeight: 21,
    marginBottom: 8,
  },
  roiSubTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 8,
    marginBottom: 6,
  },
  roiLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  roiLineText: {
    flex: 1,
  },
  roiAction: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 2,
  },
  roiNote: {
    fontSize: 11,
    color: COLORS.textMuted,
    lineHeight: 16,
    marginTop: 4,
  },
  roiAdviceBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: `${COLORS.primary}1A`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}40`,
  },
  roiAdviceTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  roiAdviceHeadline: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 6,
  },
  roiAdviceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${COLORS.primary}66`,
  },
  roiAdviceButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  noRoiData: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noRoiDataText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  noRoiDataSubtext: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
});
