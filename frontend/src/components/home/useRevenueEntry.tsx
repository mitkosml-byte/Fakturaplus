import React, { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';
import { Alert } from '../../utils/alert';
import { Toast } from '../../utils/toast';
import { Haptics } from '../../utils/haptics';
import { api } from '../../services/api';
import { useTranslation } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import { LocationPicker } from '../LocationPicker';
import { useLocationChoice, useLocationsStore } from '../../stores/locationsStore';
import { RevenueModal, rateAmountsTotal } from './RevenueModal';
import type { VatGroupAmount, ZReportResult } from '../../types';
import { pickScanImage } from '../../utils/scanImage';
import { formatAmount, parseAmount } from '../../utils/money';

type Options = {
  // The day the form opens on when none is given (Home: inside the period
  // it shows; Team: today).
  defaultDate: () => Date;
  // After a save - what the screen shows again.
  onSaved?: () => void;
  // The form's "import history" link - only where the screen has the import.
  onImportHistory?: () => void;
};

// The day's revenue form ("Дневен оборот") with all it does - the day's
// saved values, "same as yesterday", the till's daily report from a photo,
// the VAT split, the location - one form for every screen that opens it:
// Home, and Team for whoever enters the revenue but has no Home.
export function useRevenueEntry({ defaultDate, onSaved, onImportHistory }: Options) {
  const { t, language, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const [revenueModalVisible, setRevenueModalVisible] = useState(false);
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
  const [isRevenueDatePickerVisible, setRevenueDatePickerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Which location the day's revenue is for (Н11): until picked, the one
  // used last on this device. Nothing shows without locations.
  const { fallback: defaultLocation } = useLocationChoice();
  const rememberLocation = useLocationsStore((state) => state.remember);
  const [revenueLocationPick, setRevenueLocationPick] = useState<string | null | undefined>(undefined);
  const revenueLocation = revenueLocationPick === undefined ? defaultLocation : revenueLocationPick;
  // Only someone who sees pocket money sees or sets it.
  const canSeePocketMoney = hasPermission('view_pocket_money');

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
      const amounts = Object.entries(revenueRateAmounts).map(([rate, value]) => [Number(rate), parseAmount(value)] as const);
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

  // Dismissing without saving must not leave revenueDate pointing at
  // whatever day was last browsed with the prev/next arrows or the date
  // picker - otherwise the NEXT tap of the "Дневен оборот" quick action
  // silently reopens on that stale day instead of the one matching the
  // currently-viewed period, and a correction typed there lands on the
  // wrong date while the dashboard you're looking at looks unchanged.
  const closeRevenueModal = () => {
    setRevenueModalVisible(false);
    setRevenueLocationPick(undefined);
    setRevenueDate(defaultDate());
  };

  const handleAddRevenue = async () => {
    const fiscalTotal = revenueSplitByRate ? rateAmountsTotal(revenueRateAmounts) : parseAmount(fiscalRevenue);
    if (!fiscalTotal && !parseAmount(pocketMoney)) {
      Alert.alert(t('common.error'), t('msg.enterAtLeastOne'));
      return;
    }
    if (isSubmitting) return;

    // By rate, the till total is the sum of the rates (the server adds them
    // up); else one total at one rate.
    const vatGroups = Object.entries(revenueRateAmounts)
      .map(([rate, value]) => ({ rate_percent: Number(rate), amount: Math.round(parseAmount(value) * 100) / 100 }))
      .filter((group) => group.amount > 0);
    setIsSubmitting(true);
    try {
      await api.createDailyRevenue({
        date: format(revenueDate, 'yyyy-MM-dd'),
        ...(revenueSplitByRate && vatGroups.length > 0
          ? { vat_groups: vatGroups }
          : { fiscal_revenue: fiscalTotal, vat_rate_percent: revenueVatRate, vat_groups: [] }),
        // Only someone who sees pocket money sets it - for anyone else the
        // field is hidden and the day keeps what it holds.
        ...(canSeePocketMoney ? { pocket_money: parseAmount(pocketMoney) } : {}),
        card_revenue: parseAmount(cardRevenue),
        location_id: revenueLocation,
      });
      if (revenueLocation) rememberLocation(revenueLocation);
      setRevenueLocationPick(undefined);
      setRevenueModalVisible(false);
      setFiscalRevenue('');
      setPocketMoney('');
      setCardRevenue('');
      showRevenueVat([], 20);
      setRevenueDate(defaultDate());
      onSaved?.();
      Haptics.success();
      Toast.success(t('msg.revenueSaved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Opens the form on a day (none given: the screen's default day).
  const open = useCallback((date?: Date) => {
    setRevenueDate(date ?? defaultDate());
    setRevenueModalVisible(true);
  }, [defaultDate]);

  // Opens the form on a day with a sale read by the scan screen, added to
  // what the day already holds (see the load above).
  const openWithSale = useCallback((date: Date, sale: { amount: number; vatRate: 20 | 9 | 0 }) => {
    pendingOcrRevenueRef.current = sale;
    setRevenueDate(date);
    setRevenueModalVisible(true);
  }, []);

  const modal = (
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
      isSubmitting={isSubmitting}
      onSubmit={handleAddRevenue}
      onImportHistory={onImportHistory ? () => { closeRevenueModal(); onImportHistory(); } : undefined}
      locationSlot={
        <LocationPicker
          value={revenueLocation}
          onChange={setRevenueLocationPick}
          noneLabel={t('locations.noneShared')}
          hint={revenueLocation === null ? t('locations.revenueNoneHint') : t('locations.revenueHint')}
        />
      }
    />
  );

  return { open, openWithSale, modal };
}
