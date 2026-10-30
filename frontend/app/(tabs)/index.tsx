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
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import { api } from '../../src/services/api';
import { Summary, DailyRevenue, NonInvoiceExpense } from '../../src/types';
import { format, subDays } from 'date-fns';
import { bg } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import { useAuth } from '../../src/contexts/AuthContext';
import ExcelImportModal from '../../src/components/ExcelImportModal';
import { PeriodNavigator } from '../../src/components/PeriodNavigator';
import { ClosedDaysCalendar } from '../../src/components/ClosedDaysCalendar';
import { ScanCreditsBadge, useDirectionalReveal, CountUp, SkeletonStat, CelebrationGlow, PersonalWalletTeaser, MorningBriefingCard } from '../../src/components';
import Animated from 'react-native-reanimated';
import { PeriodState, DEFAULT_PERIOD_STATE, getPeriodBounds, toApiDate } from '../../src/utils/periodRange';
import { COLORS } from '../../src/theme/colors';
import { PersonalExpenseModal } from '../../src/components/home/PersonalExpenseModal';
import { RevenueModal } from '../../src/components/home/RevenueModal';
import { ExpenseModal } from '../../src/components/home/ExpenseModal';
import { getDescriptionSuggestions } from '../../src/utils/expenseSuggestions';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function HomeScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { isOwner, hasPermission } = useAuth();
  const router = useRouter();
  const ocrParams = useLocalSearchParams<{ ocrDate?: string; ocrFiscalRevenue?: string; ocrVatRate?: string }>();

  const [summary, setSummary] = useState<Summary | null>(null);
  // Which period the dashboard cards below are showing - defaults to the
  // current (in-progress) calendar month, matching the previous hardcoded
  // behavior, but lets the user step back to any past day/week/month/year
  // or a custom range instead of the cards just going silent at zero on the
  // 1st of a new month with no way back to see where last month's data went.
  const [periodState, setPeriodState] = useState<PeriodState>(DEFAULT_PERIOD_STATE);

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

  // Open (non-closed) days within the selected period - drives the average
  // daily turnover card below instead of the raw day count, so a rest day
  // (see Профил > Почивни дни) doesn't drag the average down. Defaults to
  // the day-of-month itself until the real count loads, matching the
  // previous behavior for that first render.
  const [openDaysThisMonth, setOpenDaysThisMonth] = useState<number>(new Date().getDate());
  const [refreshing, setRefreshing] = useState(false);
  const [revenueModalVisible, setRevenueModalVisible] = useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [importRevenueModalVisible, setImportRevenueModalVisible] = useState(false);
  const [importExpenseModalVisible, setImportExpenseModalVisible] = useState(false);
  const [personalExpenseModalVisible, setPersonalExpenseModalVisible] = useState(false);
  
  // ROI state (owner only)
  const [roiData, setRoiData] = useState<any>(null);
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
  const [revenueDate, setRevenueDate] = useState(new Date());
  // Shared across the revenue/expense/personal-expense modals below - only
  // one is ever open at a time, and this guards against a rapid double-tap
  // on Save creating a duplicate record.
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);

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

  const loadData = useCallback(async () => {
    const bounds = getPeriodBounds(periodState);
    const start_date = toApiDate(bounds.start);
    const end_date = toApiDate(bounds.end);

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

    try {
      const openDays = await api.getOpenDaysCount(start_date, end_date);
      setOpenDaysThisMonth(Math.max(1, openDays.open_days));
    } catch (error) {
      console.error('Error loading open-days count:', error);
    }
  }, [periodState]);

  // Pre-fills the form with whatever is already logged for this date, so
  // saving corrects that value directly instead of adding a delta to it -
  // opening the form for a date with nothing logged yet leaves it at 0.
  // Returns what it found (or null) so callers - like the OCR hand-off
  // below - can react to whether the day already had something logged.
  const loadCurrentDayRevenue = useCallback(async (date: Date) => {
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const data = await api.getRevenueByDate(dateStr);
      setFiscalRevenue(data.fiscal_revenue > 0 ? data.fiscal_revenue.toString() : '');
      setPocketMoney(data.pocket_money > 0 ? data.pocket_money.toString() : '');
      setCardRevenue(data.card_revenue > 0 ? data.card_revenue.toString() : '');
      setRevenueVatRate(data.vat_rate_percent || 20);
      return data;
    } catch (error) {
      setFiscalRevenue('');
      setPocketMoney('');
      setCardRevenue('');
      setRevenueVatRate(20);
      return null;
    }
  }, []);

  // One-tap "copy yesterday's split forward" for a steady-traffic day -
  // reuses the same getRevenueByDate call loadCurrentDayRevenue already
  // makes, just for revenueDate - 1, and overwrites the form the same way
  // opening the modal pre-fills it.
  const [copyingYesterday, setCopyingYesterday] = useState(false);
  const handleCopyYesterday = async () => {
    setCopyingYesterday(true);
    try {
      const yesterdayStr = format(subDays(revenueDate, 1), 'yyyy-MM-dd');
      const data = await api.getRevenueByDate(yesterdayStr);
      if (!data || (data.fiscal_revenue === 0 && data.card_revenue === 0 && data.pocket_money === 0)) {
        Alert.alert(t('home.sameAsYesterday'), t('home.sameAsYesterdayEmpty'));
        return;
      }
      setFiscalRevenue(data.fiscal_revenue > 0 ? data.fiscal_revenue.toString() : '');
      setPocketMoney(data.pocket_money > 0 ? data.pocket_money.toString() : '');
      setCardRevenue(data.card_revenue > 0 ? data.card_revenue.toString() : '');
      setRevenueVatRate(data.vat_rate_percent || 20);
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
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Set by the scan screen's "sales" mode hand-off (see the effect below) -
  // a ref, not state, so consuming it doesn't itself retrigger the load
  // effect it's read from.
  const pendingOcrRevenueRef = useRef<{ amount: number; vatRate: 20 | 9 | 0 } | null>(null);
  const [ocrAdditionNote, setOcrAdditionNote] = useState<string | null>(null);

  // Load current day revenue when revenue modal opens or date changes, then
  // fold in a pending OCR-scanned sale on top of whatever was already
  // there - never replacing it - so scanning a receipt for a day that
  // already has manually-logged sales adds to the total instead of erasing it.
  useEffect(() => {
    if (!revenueModalVisible) return;
    (async () => {
      const existing = await loadCurrentDayRevenue(revenueDate);
      const pending = pendingOcrRevenueRef.current;
      if (pending) {
        const existingFiscal = existing?.fiscal_revenue || 0;
        setFiscalRevenue((existingFiscal + pending.amount).toFixed(2));
        if (!existing || existingFiscal === 0) {
          setRevenueVatRate(pending.vatRate);
        }
        setOcrAdditionNote(
          t('home.ocrAdditionNote').replace('{amount}', pending.amount.toFixed(2))
        );
        pendingOcrRevenueRef.current = null;
      } else {
        setOcrAdditionNote(null);
      }
    })();
    // t() is a plain function from useTranslation(), recreated on every
    // render (not memoized) - listing it here would refire this effect on
    // every render and re-fetch/overwrite the addition it just applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueModalVisible, revenueDate, loadCurrentDayRevenue]);

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
      const data = await api.getROIAnalysis({
        month: periodStart.getMonth() + 1,
        year: periodStart.getFullYear(),
      });
      setRoiData(data);
    } catch (error) {
      console.error('Error loading ROI:', error);
      setRoiData(null);
    } finally {
      setLoadingRoi(false);
    }
  }, [canViewPersonalInvestments, periodState]);

  useFocusEffect(
    useCallback(() => {
      if (canViewPersonalInvestments) {
        loadRoiData();
      }
    }, [canViewPersonalInvestments, loadRoiData])
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
    setRevenueDate(getDefaultActionDate());
  };

  const handleAddRevenue = async () => {
    if (!fiscalRevenue && !pocketMoney) {
      Alert.alert(t('common.error'), t('msg.enterAtLeastOne'));
      return;
    }
    if (isSubmittingForm) return;

    setIsSubmittingForm(true);
    try {
      await api.createDailyRevenue({
        date: format(revenueDate, 'yyyy-MM-dd'),
        fiscal_revenue: parseFloat(fiscalRevenue) || 0,
        pocket_money: parseFloat(pocketMoney) || 0,
        card_revenue: parseFloat(cardRevenue) || 0,
        vat_rate_percent: revenueVatRate,
      });
      setRevenueModalVisible(false);
      setFiscalRevenue('');
      setPocketMoney('');
      setCardRevenue('');
      setRevenueVatRate(20);
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
      });
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
  const avgDailyTurnover = (summary?.total_income || 0) / openDaysThisMonth;

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <ScrollView
            style={styles.scrollView}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.greeting}>{t('home.welcome')}</Text>
                <Text style={styles.date}>{today}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ScanCreditsBadge />
                <View style={styles.headerIcon}>
                  <Ionicons name="receipt" size={28} color={COLORS.primary} />
                </View>
              </View>
            </View>

            <MorningBriefingCard refreshSignal={summary} />

            <PeriodNavigator state={periodState} onChange={handlePeriodChange} />

            <Animated.View style={periodReveal.style}>
            {/* Summary Cards - skeletons stand in until the first real
                summary lands, so these never flash "0.00 €" for data that
                just hasn't arrived yet. */}
            {!summary ? (
              <>
                <View style={styles.summaryContainer}>
                  <SkeletonStat style={[styles.summaryCard, styles.incomeCard]} />
                  <SkeletonStat style={[styles.summaryCard, styles.expenseCard]} />
                </View>
                <View style={styles.summaryContainer}>
                  <SkeletonStat style={[styles.summaryCard, styles.cashCard]} />
                  <SkeletonStat style={[styles.summaryCard, styles.cardCard]} />
                </View>
              </>
            ) : (
            <>
            <View style={styles.summaryContainer}>
              <View style={[styles.summaryCard, styles.incomeCard]}>
                <View style={styles.cardIcon}>
                  <Ionicons name="trending-up" size={24} color={COLORS.success} />
                </View>
                <Text style={styles.cardLabel}>{t('home.totalIncome')}</Text>
                <CountUp
                  value={summary?.total_income || 0}
                  formatter={(n) => `${n.toFixed(2)} €`}
                  style={[styles.cardValue, { color: COLORS.success }]}
                />
              </View>

              <View style={[styles.summaryCard, styles.expenseCard]}>
                <View style={styles.cardIcon}>
                  <Ionicons name="trending-down" size={24} color={COLORS.danger} />
            </View>
            <Text style={styles.cardLabel}>{t('home.totalExpenses')}</Text>
            <CountUp
              value={summary?.total_expense || 0}
              formatter={(n) => `${n.toFixed(2)} €`}
              style={[styles.cardValue, { color: COLORS.danger }]}
            />
          </View>
        </View>

        {/* Cash vs Card breakdown of the fiscalized revenue */}
        <View style={styles.summaryContainer}>
          <View style={[styles.summaryCard, styles.cashCard]}>
            <View style={styles.cardIcon}>
              <Ionicons name="cash-outline" size={24} color={COLORS.success} />
            </View>
            <Text style={styles.cardLabel}>{t('home.cashRevenue')}</Text>
            <CountUp
              value={summary?.total_cash_revenue || 0}
              formatter={(n) => `${n.toFixed(2)} €`}
              style={[styles.cardValue, { color: COLORS.success }]}
            />
          </View>

          <View style={[styles.summaryCard, styles.cardCard]}>
            <View style={styles.cardIcon}>
              <Ionicons name="card-outline" size={24} color={COLORS.info} />
            </View>
            <Text style={styles.cardLabel}>{t('home.cardRevenue')}</Text>
            <CountUp
              value={summary?.total_card_revenue || 0}
              formatter={(n) => `${n.toFixed(2)} €`}
              style={[styles.cardValue, { color: COLORS.info }]}
            />
          </View>
        </View>
            </>
            )}

        {/* VAT Card */}
        <View style={styles.vatCard}>
          <View style={styles.vatHeader}>
            <Ionicons name="calculator" size={24} color={COLORS.primary} />
            <Text style={styles.vatTitle}>{t('home.vatToPay')}</Text>
          </View>
          <CountUp
            value={summary?.vat_to_pay || 0}
            formatter={(n) => `${n.toFixed(2)} €`}
            style={[styles.vatValue, { color: (summary?.vat_to_pay || 0) >= 0 ? COLORS.danger : COLORS.success }]}
          />
          <View style={styles.vatDetails}>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>{t('stats.vatFromSales')}:</Text>
              <Text style={styles.vatDetailValue}>{summary?.fiscal_vat.toFixed(2) || '0.00'} €</Text>
            </View>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>{t('stats.vatCredit')}:</Text>
              <Text style={styles.vatDetailValue}>-{summary?.total_invoice_vat.toFixed(2) || '0.00'} €</Text>
            </View>
          </View>
        </View>
            </Animated.View>

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

        {/* Average Daily Turnover - taps through to the same stat in Statistics,
            broken down by period, for deeper business analysis */}
        <TouchableOpacity
          style={styles.avgTurnoverCard}
          onPress={() => router.push({
            pathname: '/(tabs)/stats',
            params: { period: periodState.mode === 'week' || periodState.mode === 'year' ? periodState.mode : 'month' },
          })}
          activeOpacity={0.8}
        >
          <View style={styles.avgTurnoverHeader}>
            <Ionicons name="speedometer" size={24} color={COLORS.info} />
            <Text style={styles.avgTurnoverTitle}>{t('home.avgDailyTurnover')}</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </View>
          <CountUp
            value={avgDailyTurnover}
            formatter={(n) => `${(Number.isFinite(n) ? n : 0).toFixed(2)} €`}
            style={styles.avgTurnoverValue}
          />
          <Text style={styles.avgTurnoverSubtitle}>
            {t('home.avgDailyTurnoverSubtitle').replace('{days}', String(openDaysThisMonth))}
          </Text>
        </TouchableOpacity>

        {/* Closed/open-days calendar - embedded here (collapsed by default)
            so it's regularly filled in without needing a trip to Profile,
            since it directly feeds the average-turnover figure above. */}
        {hasPermission('manage_company') && (
          <View style={{ marginBottom: 16 }}>
            <ClosedDaysCalendar collapsible />
          </View>
        )}

        {/* Personal wallet teaser - collapsed by default, see component for
            why it's gated here rather than inside it. */}
        {hasPermission('view_personal_wallet') && <PersonalWalletTeaser refreshSignal={summary} />}

        {/* Stats Overview */}
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <CountUp value={summary?.invoice_count || 0} formatter={(n) => `${Math.round(n)}`} style={styles.statValue} />
            <Text style={styles.statLabel}>{t('home.invoices')}</Text>
          </View>
          <View style={styles.statItem}>
            <CountUp value={summary?.total_fiscal_revenue || 0} formatter={(n) => `${n.toFixed(0)}`} style={styles.statValue} />
            <Text style={styles.statLabel}>{t('home.fiscalRevenue')}</Text>
          </View>
          <TouchableOpacity
            style={styles.statItem}
            onPress={() => router.push('/pocket-money-history')}
            disabled={summary?.total_pocket_money === null}
          >
            {summary && summary.total_pocket_money === null ? (
              <Ionicons name="lock-closed" size={18} color={COLORS.textMuted} style={{ marginBottom: 4 }} />
            ) : (
              <CountUp value={summary?.total_pocket_money || 0} formatter={(n) => `${n.toFixed(0)}`} style={styles.statValue} />
            )}
            <Text style={styles.statLabel}>{t('home.pocket')}</Text>
          </TouchableOpacity>
          <View style={[styles.statItem, { overflow: 'visible' }]}>
            <CelebrationGlow trigger={celebrateProfit} onDone={() => setCelebrateProfit(false)} />
            {summary && summary.profit === null ? (
              <Ionicons name="lock-closed" size={18} color={COLORS.textMuted} style={{ marginBottom: 4 }} />
            ) : (
              <CountUp
                value={summary?.profit || 0}
                formatter={(n) => `${n.toFixed(0)}`}
                style={[styles.statValue, { color: (summary?.profit || 0) >= 0 ? COLORS.success : COLORS.danger }]}
              />
            )}
            <Text style={styles.statLabel}>{t('home.profit')}</Text>
          </View>
        </View>

        {summary?.financial_visibility && (
          summary.financial_visibility.pocket_money === false ||
          summary.financial_visibility.off_book_expenses === false ||
          summary.financial_visibility.profit === false
        ) && (
          <View style={styles.restrictedNote}>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.restrictedNoteText}>{t('home.restrictedDataNote')}</Text>
          </View>
        )}

        {/* Action Buttons - each gated on its own permission (an owner can
            fine-tune these independently per member via the permissions
            checklist), rather than showing a button whose only possible
            outcome is a permission-denied error from the backend. */}
        {(hasPermission('add_revenue') || hasPermission('add_expenses')) && (
          <View style={styles.actionsContainer}>
            {hasPermission('add_revenue') && (
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

        {(hasPermission('add_revenue') || hasPermission('add_expenses')) && (
          <View style={styles.importLinksRow}>
            {hasPermission('add_revenue') && (
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
        {canViewPersonalInvestments && (
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

                {/* AI Insights */}
                {roiData.ai_insights && roiData.ai_insights.length > 0 && (
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
        ocrAdditionNote={ocrAdditionNote}
        fiscalRevenue={fiscalRevenue}
        onChangeFiscalRevenue={setFiscalRevenue}
        cardRevenue={cardRevenue}
        onChangeCardRevenue={setCardRevenue}
        vatRate={revenueVatRate}
        onChangeVatRate={setRevenueVatRate}
        pocketMoney={pocketMoney}
        onChangePocketMoney={setPocketMoney}
        isSubmitting={isSubmittingForm}
        onSubmit={handleAddRevenue}
      />

      {/* Expense Modal */}
      <ExpenseModal
        visible={expenseModalVisible}
        onClose={() => {
          setExpenseModalVisible(false);
          setExpenseDate(getDefaultActionDate());
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
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
