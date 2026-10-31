import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { BottomSheet, PressableScale, Expandable, SuggestionChips } from '..';
import type { DescriptionSuggestion } from '../../utils/expenseSuggestions';

// Extracted from index.tsx (Module 1 audit finding #4). Owner-only form for
// adding a personal expense/investment, scoped to the dashboard's current period.
export type PersonalExpenseType = 'investment' | 'recurring' | 'one_time';
export type PersonalExpenseCategory = 'goods' | 'service' | 'personnel' | 'rent' | 'extraordinary' | 'other';

type Props = {
  visible: boolean;
  onClose: () => void;
  periodLabel: string;
  amount: string;
  amountError: boolean;
  onChangeAmount: (value: string) => void;
  description: string;
  descriptionError: boolean;
  onChangeDescription: (value: string) => void;
  type: string;
  onChangeType: (type: PersonalExpenseType) => void;
  category: string;
  onChangeCategory: (category: PersonalExpenseCategory) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  language: string;
  suggestions?: DescriptionSuggestion[];
  onPickSuggestion?: (s: DescriptionSuggestion) => void;
};

export function PersonalExpenseModal({
  visible, onClose, periodLabel, amount, amountError, onChangeAmount,
  description, descriptionError, onChangeDescription, type, onChangeType,
  category, onChangeCategory, isSubmitting, onSubmit, language,
  suggestions, onPickSuggestion,
}: Props) {
  const { t } = useTranslation();

  const categories: { key: PersonalExpenseCategory; label: string }[] = [
    { key: 'goods', label: t('personal.categoryGoods') },
    { key: 'service', label: t('personal.categoryService') },
    { key: 'personnel', label: t('personal.categoryPersonnel') },
    { key: 'rent', label: t('personal.categoryRent') },
    { key: 'extraordinary', label: t('personal.categoryExtraordinary') },
    { key: 'other', label: t('personal.categoryOther') },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={[styles.modalContent, { maxHeight: '90%' }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{t('personal.addExpense')}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.editNoticeBanner}>
            <Ionicons name="information-circle" size={18} color={COLORS.primary} />
            <Text style={styles.editNoticeText}>
              {t('personal.periodNotice').replace('{period}', periodLabel)}
            </Text>
          </View>

          {suggestions && onPickSuggestion && (
            <SuggestionChips
              suggestions={suggestions}
              label={t('expenses.recentDescriptions')}
              onPick={onPickSuggestion}
            />
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t('personal.amount')}</Text>
            <TextInput
              style={[styles.input, amountError && styles.inputErrorBorder]}
              placeholder="0.00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={onChangeAmount}
            />
            <Expandable expanded={amountError}>
              <Text style={styles.fieldErrorText}>{t('budget.invalidAmount')}</Text>
            </Expandable>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t('personal.description')}</Text>
            <TextInput
              style={[styles.input, descriptionError && styles.inputErrorBorder]}
              placeholder={language === 'bg' ? 'напр. Наем, Заплати...' : 'e.g. Rent, Salaries...'}
              placeholderTextColor={COLORS.textMuted}
              value={description}
              onChangeText={onChangeDescription}
            />
            <Expandable expanded={descriptionError}>
              <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
            </Expandable>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{language === 'bg' ? 'Тип' : 'Type'}</Text>
            <View style={styles.typeSelector}>
              <TouchableOpacity
                style={[styles.typeButton, type === 'investment' && styles.typeButtonActive]}
                onPress={() => onChangeType('investment')}
              >
                <Text style={[styles.typeButtonText, type === 'investment' && styles.typeButtonTextActive]}>
                  {t('personal.typeInvestment')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeButton, type === 'recurring' && styles.typeButtonActive]}
                onPress={() => onChangeType('recurring')}
              >
                <Text style={[styles.typeButtonText, type === 'recurring' && styles.typeButtonTextActive]}>
                  {t('personal.typeRecurring')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeButton, type === 'one_time' && styles.typeButtonActive]}
                onPress={() => onChangeType('one_time')}
              >
                <Text style={[styles.typeButtonText, type === 'one_time' && styles.typeButtonTextActive]}>
                  {t('personal.typeOneTime')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{language === 'bg' ? 'Категория' : 'Category'}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.categoryChip, category === cat.key && styles.categoryChipActive]}
                  onPress={() => onChangeCategory(cat.key)}
                >
                  <Text style={[styles.categoryChipText, category === cat.key && styles.categoryChipTextActive]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <PressableScale style={styles.submitButton} onPress={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('common.save')}</Text>}
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
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeButtonText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  typeButtonTextActive: {
    color: 'white',
    fontWeight: '600',
  },
  categoryScroll: {
    flexDirection: 'row',
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryChipText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  categoryChipTextActive: {
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
