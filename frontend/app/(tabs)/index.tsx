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
import { format } from 'date-fns';
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
import { useRevenueEntry } from '../../src/components/home/useRevenueEntry';
import { ExpenseModal } from '../../src/components/home/ExpenseModal';
import { BillingOverviewCard } from '../../src/components/home/BillingOverviewCard';
import { GettingStartedCard } from '../../src/components/home/GettingStartedCard';
import { DayCard } from '../../src/components/home/DayCard';
import { PersonalWalletCard } from '../../src/components/home/PersonalWalletCard';
import { MarginsCard } from '../../src/components/home/MarginsCard';
import { VatCard } from '../../src/components/home/VatCard';
import { useModules } from '../../src/stores/modulesStore';
import { useShowTeamTab } from '../../src/hooks/useTeamTab';
import { useOnboardingStore } from '../../src/stores/onboardingStore';
import { getDescriptionSuggestions } from '../../src/utils/expenseSuggestions';
import { formatMoney, parseAmount, readAmount } from '../../src/utils/money';

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
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [importRevenueModalVisible, setImportRevenueModalVisible] = useState(false);
  const [importExpenseModalVisible, setImportExpenseModalVisible] = useState(false);

  // Shared across the revenue/expense/personal-expense modals below - only
  // one is ever open at a time, and this guards against a rapid double-tap
  // on Save creating a duplicate record.
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  // Which location a day's revenue or an expense is for (Н11): until
  // picked, the one used last on this device. Nothing shows without locations.
  const { fallback: defaultLocation } = useLocationChoice();
  const rememberLocation = useLocationsStore((state) => state.remember);
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
          const data = await api.getHome({ start_date, end_date, with_billing: showBilling, language });
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
  }, [periodState, showBilling, language]);

  // The day's revenue form - the same one Team opens for whoever enters the
  // revenue but has no Home.
  const revenueEntry = useRevenueEntry({
    defaultDate: getDefaultActionDate,
    onSaved: loadData,
    onImportHistory: () => setImportRevenueModalVisible(true),
  });


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


  // Hand-off from the scan screen's "sales" mode: a receipt/invoice the
  // business itself issued was recognized there, and its amount/date/VAT
  // rate arrive as router params so this reuses the SAME modal (and its
  // existing-value loading above) rather than a separate save path that
  // could silently overwrite the day's other sales.
  useEffect(() => {
    if (!ocrParams.ocrDate || !ocrParams.ocrFiscalRevenue) return;
    const amount = parseAmount(ocrParams.ocrFiscalRevenue);
    const vatRateNum = parseInt(ocrParams.ocrVatRate || '20', 10);
    const vatRate: 20 | 9 | 0 = vatRateNum === 9 ? 9 : vatRateNum === 0 ? 0 : 20;
    revenueEntry.openWithSale(new Date(`${ocrParams.ocrDate}T00:00:00`), { amount, vatRate });
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
    revenueEntry.open(new Date(`${ocrParams.revenueDate}T00:00:00`));
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


  const submitExpense = async () => {
    setIsSubmittingForm(true);
    try {
      await api.createExpense({
        description: expenseDescription,
        amount: readAmount(expenseAmount),
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
    const missingAmount = !(readAmount(expenseAmount) > 0);
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

  // The day's actions, in the order a day goes: the till's revenue, an
  // expense, an invoice to a customer.
  const homeActions: { key: string; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void }[] = [
    ...(usesTill && hasPermission('add_revenue') ? [{
      key: 'revenue', label: t('home.dailyRevenue'), hint: t('home.actionRevenueHint'), icon: 'cash' as const, color: COLORS.success,
      onPress: () => revenueEntry.open(),
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
  // Джобче added up - for who sees both) and its expenses; for whoever sees
  // the personal notebook, the company money spent personally and what is
  // left in the business after it - never a business expense.
  const ledgerRows: { key: string; label: string; value: number; tone?: string; onPress?: () => void }[] = [];
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
    // The period's personal use and what is left in the business after it,
    // once something was taken - except for this month, which the notebook
    // card right below already shows (the same two numbers twice otherwise).
    const personal = summary.personal_withdrawals;
    const notebookCardShows = uses('wallet') && hasPermission('view_personal_wallet') && !!home?.personal_wallet;
    const thisMonth = periodState.mode === 'month' && periodState.offset === 0;
    if (personal != null && personal > 0 && !(notebookCardShows && thisMonth)) {
      ledgerRows.push({
        key: 'personal', label: t('home.personalUse'), value: -personal, tone: COLORS.warning,
        onPress: () => router.push({ pathname: '/personal-expenses', params: { tab: 'wallet' } }),
      });
      if (summary.left_after_personal != null) {
        ledgerRows.push({
          key: 'left', label: t('home.leftInBusiness'), value: summary.left_after_personal,
          tone: summary.left_after_personal >= 0 ? COLORS.success : COLORS.danger,
        });
      }
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
            {/* The day card instead of "Welcome!": a personal greeting, the
                weather where the business is, one line for the day and what
                the day holds for this person. */}
            <DayCard
              data={home?.day_card}
              onPlaceSet={loadData}
              right={(
                <>
                  <ScanCreditsBadge balance={home ? home.scan_credits : null} />
                  <TouchableOpacity
                    style={styles.helpButton}
                    onPress={() => router.push('/help')}
                    accessibilityLabel={t('tutorial.helpButtonLabel')}
                    hitSlop={6}
                  >
                    <Ionicons name="help" size={18} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </>
              )}
            />

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
              onAddRevenue={() => revenueEntry.open()}
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
                          <TouchableOpacity
                            key={row.key}
                            style={[styles.ledgerRow, index > 0 && styles.ledgerRowDivider]}
                            onPress={row.onPress}
                            disabled={!row.onPress}
                            accessibilityRole={row.onPress ? 'button' : undefined}
                          >
                            <Text style={styles.ledgerLabel}>{row.label}</Text>
                            <View style={styles.ledgerValueWrap}>
                              <Text style={[styles.ledgerValue, row.tone ? { color: row.tone } : null]}>{formatMoney(row.value)}</Text>
                              {row.onPress && <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />}
                            </View>
                          </TouchableOpacity>
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

            {/* The VAT to pay, when, and where the month is heading - for a
                business registered for VAT. */}
            <VatCard vat={home?.vat} />

            {/* The period's gross, operating and net margin - for whoever
                sees the profit. */}
            <MarginsCard margins={home?.margins} canManageBudget={hasPermission('manage_budget')} />
            </>
            )}

            {/* The personal notebook, right under the main numbers - for
                whoever may see it. */}
            {uses('wallet') && hasPermission('view_personal_wallet') && home?.personal_wallet && (
              <PersonalWalletCard
                summary={home.personal_wallet}
                canAdd={hasPermission('add_personal_wallet_entries')}
              />
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

      {revenueEntry.modal}

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
  ledgerValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  restrictedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -12,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  restrictedNoteText: {
    fontSize: 12,
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
    fontSize: 12,
    textAlign: 'center',
  },
});
