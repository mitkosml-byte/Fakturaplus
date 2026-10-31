import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays, subDays } from 'date-fns';
import { Locale } from 'date-fns';
import DateTimePickerModal from '../AppDateTimePicker';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { BottomSheet, PressableScale, Expandable, SuggestionChips } from '..';
import type { DescriptionSuggestion } from '../../utils/expenseSuggestions';

// Extracted from index.tsx (Module 1 audit finding #4). Lists off-book
// expenses recorded for a given day and lets the user add a new one.
type DayExpense = { id: string; description: string; amount: number; date: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  onViewHistory: () => void;
  date: Date;
  onChangeDate: (date: Date) => void;
  isDatePickerVisible: boolean;
  onOpenDatePicker: () => void;
  onCloseDatePicker: () => void;
  dateLocale: Locale;
  language: string;
  loadingExpenses: boolean;
  dayExpenses: DayExpense[];
  onDeleteExpense: (id: string) => void;
  description: string;
  descriptionError: boolean;
  onChangeDescription: (value: string) => void;
  amount: string;
  amountError: boolean;
  onChangeAmount: (value: string) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  suggestions?: DescriptionSuggestion[];
  onPickSuggestion?: (s: DescriptionSuggestion) => void;
};

export function ExpenseModal({
  visible, onClose, onViewHistory, date, onChangeDate, isDatePickerVisible, onOpenDatePicker,
  onCloseDatePicker, dateLocale, language, loadingExpenses, dayExpenses, onDeleteExpense,
  description, descriptionError, onChangeDescription, amount, amountError, onChangeAmount,
  isSubmitting, onSubmit, suggestions, onPickSuggestion,
}: Props) {
  const { t } = useTranslation();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={[styles.modalContent, { maxHeight: '90%' }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{t('expenses.title')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity style={styles.historyPersonalButton} onPress={onViewHistory}>
              <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.historyPersonalText}>{t('expenses.history')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
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

          <View style={styles.dayExpensesSection}>
            <Text style={styles.dayExpensesTitle}>
              {t('expenses.forDate')} {format(date, 'd MMM', { locale: dateLocale })}:
            </Text>

            {loadingExpenses ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={COLORS.warning} />
              </View>
            ) : dayExpenses.length > 0 ? (
              <>
                {dayExpenses.map((expense, index) => (
                  <View key={expense.id} style={styles.expenseItem}>
                    <View style={styles.expenseItemLeft}>
                      <Text style={styles.expenseItemIndex}>{index + 1}.</Text>
                      <Text style={styles.expenseItemDescription}>{expense.description}</Text>
                    </View>
                    <View style={styles.expenseItemRight}>
                      <Text style={styles.expenseItemAmount}>{expense.amount.toFixed(2)} €</Text>
                      <TouchableOpacity style={styles.expenseDeleteButton} onPress={() => onDeleteExpense(expense.id)}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <View style={styles.expensesTotalRow}>
                  <Text style={styles.expensesTotalLabel}>{t('expenses.totalForDay')}:</Text>
                  <Text style={styles.expensesTotalValue}>
                    {dayExpenses.reduce((sum, e) => sum + e.amount, 0).toFixed(2)} €
                  </Text>
                </View>
              </>
            ) : (
              <Text style={styles.noExpensesText}>{t('expenses.noExpenses')}</Text>
            )}
          </View>

          <View style={styles.addExpenseSection}>
            <Text style={styles.addExpenseTitle}>{t('expenses.addNew')}:</Text>

            {suggestions && onPickSuggestion && (
              <SuggestionChips
                suggestions={suggestions}
                label={t('expenses.recentDescriptions')}
                onPick={onPickSuggestion}
              />
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('expenses.description')}</Text>
              <TextInput
                style={[styles.input, descriptionError && styles.inputErrorBorder]}
                value={description}
                onChangeText={onChangeDescription}
                placeholder={t('expenses.placeholder')}
                placeholderTextColor={COLORS.textMuted}
              />
              <Expandable expanded={descriptionError}>
                <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
              </Expandable>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('expenses.amount')} (€)</Text>
              <TextInput
                style={[styles.input, amountError && styles.inputErrorBorder]}
                value={amount}
                onChangeText={onChangeAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
              />
              <Expandable expanded={amountError}>
                <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
              </Expandable>
            </View>

            <PressableScale style={[styles.submitButton, { backgroundColor: COLORS.warning }]} onPress={onSubmit} disabled={isSubmitting}>
              {isSubmitting ? <ActivityIndicator color="white" /> : (
                <>
                  <Ionicons name="add-circle" size={20} color="white" />
                  <Text style={styles.submitButtonText}>{t('expenses.add')}</Text>
                </>
              )}
            </PressableScale>
          </View>
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
  historyPersonalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  historyPersonalText: {
    fontSize: 12,
    color: COLORS.textSecondary,
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
  inputErrorBorder: {
    borderColor: COLORS.danger,
  },
  fieldErrorText: {
    fontSize: 12,
    color: COLORS.danger,
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
  dayExpensesSection: {
    marginBottom: 20,
  },
  dayExpensesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  loadingContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  expenseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  expenseItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  expenseItemIndex: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  expenseItemDescription: {
    fontSize: 14,
    color: 'white',
    flex: 1,
  },
  expenseItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  expenseItemAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  expenseDeleteButton: {
    padding: 4,
  },
  expensesTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: 4,
  },
  expensesTotalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  expensesTotalValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.warning,
  },
  noExpensesText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  addExpenseSection: {
    marginTop: 4,
  },
  addExpenseTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
