import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays, subDays } from 'date-fns';
import { Locale } from 'date-fns';
import DateTimePickerModal from '../AppDateTimePicker';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { BottomSheet, PressableScale } from '..';

// Extracted from index.tsx (Module 1 audit finding #4). Edit-in-place form
// for a single day's revenue (fiscal, card-paid portion, VAT rate, pocket money).
export const VAT_RATES = [20, 9, 0];

// The rates a day's split shows: the usual three, and any other its
// groups hold, highest first.
export function ratesShown(rateAmounts: Record<number, string>): number[] {
  return Array.from(new Set([...VAT_RATES, ...Object.keys(rateAmounts).map(Number)])).sort((a, b) => b - a);
}

// The day's till total from its amounts by rate.
export function rateAmountsTotal(rateAmounts: Record<number, string>): number {
  return Object.values(rateAmounts).reduce((sum, value) => sum + (Math.round((parseFloat(value) || 0) * 100) / 100), 0);
}

type Props = {
  visible: boolean;
  onClose: () => void;
  date: Date;
  onChangeDate: (date: Date) => void;
  isDatePickerVisible: boolean;
  onOpenDatePicker: () => void;
  onCloseDatePicker: () => void;
  dateLocale: Locale;
  language: string;
  ocrAdditionNote: string | null;
  fiscalRevenue: string;
  onChangeFiscalRevenue: (value: string) => void;
  cardRevenue: string;
  onChangeCardRevenue: (value: string) => void;
  vatRate: number;
  onChangeVatRate: (rate: number) => void;
  // The day's sales by VAT rate, as the till's daily report gives them.
  splitByRate: boolean;
  onToggleSplitByRate: () => void;
  rateAmounts: Record<number, string>;
  onChangeRateAmount: (rate: number, value: string) => void;
  pocketMoney: string;
  onChangePocketMoney: (value: string) => void;
  // Hidden for someone who may not see pocket money - they would only see
  // 0 there, and the day keeps what it holds.
  showPocketMoney: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  onCopyYesterday: () => void;
  copyingYesterday: boolean;
  // The till's daily report from a photo (Н3).
  onScanReport?: () => void;
  scanningReport?: boolean;
  // Which location's part of the day this is (Н11) - only with locations.
  locationSlot?: React.ReactNode;
  // Past days from a spreadsheet - needed once, so here, not on Home.
  onImportHistory?: () => void;
};

export function RevenueModal({
  visible, onClose, date, onChangeDate, isDatePickerVisible, onOpenDatePicker, onCloseDatePicker,
  dateLocale, language, ocrAdditionNote, fiscalRevenue, onChangeFiscalRevenue, cardRevenue,
  onChangeCardRevenue, vatRate, onChangeVatRate, splitByRate, onToggleSplitByRate, rateAmounts, onChangeRateAmount,
  pocketMoney, onChangePocketMoney, showPocketMoney, isSubmitting, onSubmit,
  onCopyYesterday, copyingYesterday, onScanReport, scanningReport, locationSlot, onImportHistory,
}: Props) {
  const { t } = useTranslation();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.modalContent}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{t('home.dailyRevenue')}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t('home.date')}</Text>
            <View style={styles.datePickerContainer}>
              <TouchableOpacity style={styles.dateButton} onPress={() => onChangeDate(subDays(date, 1))}>
                <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateDisplay} onPress={onOpenDatePicker}>
                <Ionicons name="calendar" size={20} color={COLORS.primary} />
                <Text style={styles.dateText}>
                  {format(date, 'd MMMM yyyy', { locale: dateLocale })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateButton} onPress={() => onChangeDate(addDays(date, 1))}>
                <Ionicons name="chevron-forward" size={24} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <DateTimePickerModal
            isVisible={isDatePickerVisible}
            mode="date"
            date={date}
            onConfirm={(d: Date) => {
              onChangeDate(d);
              onCloseDatePicker();
            }}
            onCancel={onCloseDatePicker}
            confirmTextIOS={t('common.select')}
            cancelTextIOS={t('common.cancel')}
            locale={language}
          />

          {locationSlot}

          <View style={styles.editNoticeBanner}>
            <Ionicons name="information-circle" size={18} color={COLORS.primary} />
            <Text style={styles.editNoticeText}>{t('home.editInPlaceNotice')}</Text>
          </View>

          <TouchableOpacity style={styles.copyYesterdayButton} onPress={onCopyYesterday} disabled={copyingYesterday}>
            {copyingYesterday ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="copy-outline" size={16} color={COLORS.primary} />
            )}
            <Text style={styles.copyYesterdayText}>{t('home.sameAsYesterday')}</Text>
          </TouchableOpacity>

          {onScanReport && (
            <TouchableOpacity style={styles.copyYesterdayButton} onPress={onScanReport} disabled={scanningReport}>
              {scanningReport ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Ionicons name="camera-outline" size={16} color={COLORS.primary} />
              )}
              <Text style={styles.copyYesterdayText}>{t('home.scanReport')}</Text>
            </TouchableOpacity>
          )}

          {ocrAdditionNote && (
            <View style={[styles.editNoticeBanner, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
              <Text style={[styles.editNoticeText, { color: COLORS.successLight }]}>{ocrAdditionNote}</Text>
            </View>
          )}

          {splitByRate ? (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.vatByRate')} (€)</Text>
              {ratesShown(rateAmounts).map((rate) => (
                <View key={rate} style={styles.rateAmountRow}>
                  <Text style={styles.rateAmountLabel}>{t('home.vatRateAmount').replace('{rate}', String(rate))}</Text>
                  <TextInput
                    style={[styles.input, styles.rateAmountInput]}
                    value={rateAmounts[rate] || ''}
                    onChangeText={(value) => onChangeRateAmount(rate, value)}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>
              ))}
              <Text style={styles.rateTotal}>
                {t('home.vatByRateTotal').replace('{amount}', rateAmountsTotal(rateAmounts).toFixed(2))}
              </Text>
              <Text style={styles.inputHint}>{t('home.vatByRateHint')}</Text>
              <TouchableOpacity style={styles.splitToggle} onPress={onToggleSplitByRate}>
                <Ionicons name="remove-circle-outline" size={16} color={COLORS.primaryLight} />
                <Text style={styles.splitToggleText}>{t('home.vatOneRate')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('home.fiscalRevenueLabel')} (€)</Text>
                <TextInput
                  style={styles.input}
                  value={fiscalRevenue}
                  onChangeText={onChangeFiscalRevenue}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textMuted}
                />
                <Text style={styles.inputHint}>{t('home.includesVAT')}</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('home.vatRate')}</Text>
                <View style={styles.vatRateRow}>
                  {VAT_RATES.map((rate) => (
                    <TouchableOpacity
                      key={rate}
                      style={[styles.vatRateChip, vatRate === rate && styles.vatRateChipActive]}
                      onPress={() => onChangeVatRate(rate)}
                    >
                      <Text style={[styles.vatRateChipText, vatRate === rate && styles.vatRateChipTextActive]}>
                        {rate}%
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.inputHint}>{t('home.vatRateHint')}</Text>
                <TouchableOpacity style={styles.splitToggle} onPress={onToggleSplitByRate}>
                  <Ionicons name="git-branch-outline" size={16} color={COLORS.primaryLight} />
                  <Text style={styles.splitToggleText}>{t('home.vatSplitAction')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t('home.cardRevenueLabel')} (€)</Text>
            <TextInput
              style={styles.input}
              value={cardRevenue}
              onChangeText={onChangeCardRevenue}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={COLORS.textMuted}
            />
            <Text style={styles.inputHint}>{t('home.cardRevenueHint')}</Text>
          </View>

          {showPocketMoney && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.pocketLabel')} (€)</Text>
              <TextInput
                style={styles.input}
                value={pocketMoney}
                onChangeText={onChangePocketMoney}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
              />
              <Text style={styles.inputHint}>{t('home.pocketHint')}</Text>
            </View>
          )}

          {onImportHistory && (
            <TouchableOpacity style={styles.importLink} onPress={onImportHistory}>
              <Ionicons name="cloud-upload-outline" size={14} color={COLORS.primary} />
              <Text style={styles.importLinkText}>{t('home.importRevenueShort')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
        <PressableScale style={styles.submitButton} onPress={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('home.save')}</Text>}
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  importLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  importLinkText: { fontSize: 12, color: COLORS.primary, fontWeight: '500' },
  modalContent: {
    flexShrink: 1,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: 'white',
  },
  inputHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  datePickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dateButton: {
    padding: 8,
  },
  dateDisplay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  dateText: {
    fontSize: 15,
    color: 'white',
    fontWeight: '600',
  },
  editNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  editNoticeText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.primaryLight,
    lineHeight: 16,
  },
  copyYesterdayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    marginBottom: 16,
  },
  copyYesterdayText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primaryLight,
  },
  vatRateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  vatRateChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  vatRateChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  vatRateChipText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  vatRateChipTextActive: {
    color: 'white',
    fontWeight: '600',
  },
  rateAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  rateAmountLabel: {
    width: 110,
    fontSize: 14,
    color: 'white',
  },
  rateAmountInput: {
    flex: 1,
  },
  rateTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
    marginTop: 4,
  },
  splitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 10,
  },
  splitToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primaryLight,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
