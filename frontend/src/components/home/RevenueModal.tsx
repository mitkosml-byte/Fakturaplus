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
const VAT_RATES = [20, 9, 0];

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
  pocketMoney: string;
  onChangePocketMoney: (value: string) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
};

export function RevenueModal({
  visible, onClose, date, onChangeDate, isDatePickerVisible, onOpenDatePicker, onCloseDatePicker,
  dateLocale, language, ocrAdditionNote, fiscalRevenue, onChangeFiscalRevenue, cardRevenue,
  onChangeCardRevenue, vatRate, onChangeVatRate, pocketMoney, onChangePocketMoney, isSubmitting, onSubmit,
}: Props) {
  const { t } = useTranslation();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={[styles.modalContent, { maxHeight: '90%' }]}>
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

          <View style={styles.editNoticeBanner}>
            <Ionicons name="information-circle" size={18} color={COLORS.primary} />
            <Text style={styles.editNoticeText}>{t('home.editInPlaceNotice')}</Text>
          </View>

          {ocrAdditionNote && (
            <View style={[styles.editNoticeBanner, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
              <Text style={[styles.editNoticeText, { color: COLORS.successLight }]}>{ocrAdditionNote}</Text>
            </View>
          )}

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
          </View>

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
            <Text style={styles.inputHint}>{t('home.excludesVAT')}</Text>
          </View>

          <PressableScale style={styles.submitButton} onPress={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('home.save')}</Text>}
          </PressableScale>
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  modalContent: {
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
