import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Alert } from '../utils/alert';
import { Toast } from '../utils/toast';
import { Haptics } from '../utils/haptics';
import { api } from '../services/api';
import type { RoiAdviceResponse } from '../types';
import { useTranslation, useLanguageStore } from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { PeriodState, getPeriodBounds } from '../utils/periodRange';
import { getDescriptionSuggestions } from '../utils/expenseSuggestions';
import { COLORS } from '../theme/colors';
import { InfoButton } from './InfoButton';
import { PersonalExpenseModal } from './home/PersonalExpenseModal';

type Props = { periodState: PeriodState };

// What the owner put into the business and what it gives back, for the
// month of the period shown (the ROI endpoint and its advice are
// month-shaped). In Statistics since Л4 - Home keeps the everyday. Seen by
// the owner and anyone granted view_personal_investments; adding one stays
// the owner's.
export function PersonalInvestmentsCard({ periodState }: Props) {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { isOwner, hasPermission, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const canViewPersonalInvestments = hasPermission('view_personal_investments');

  const [roiData, setRoiData] = useState<any>(null);
  // AI advice on the numbers: shown when already kept for them, else asked
  // for with a tap (it costs a model call, so never on its own).
  const [roiAdvice, setRoiAdvice] = useState<RoiAdviceResponse | null>(null);
  const [roiAdviceLoading, setRoiAdviceLoading] = useState(false);
  const [loadingRoi, setLoadingRoi] = useState(false);

  const [personalExpenseModalVisible, setPersonalExpenseModalVisible] = useState(false);
  const [personalAmount, setPersonalAmount] = useState('');
  const [personalDescription, setPersonalDescription] = useState('');
  const [personalType, setPersonalType] = useState('recurring');
  const [personalCategory, setPersonalCategory] = useState('other');
  const [personalAmountError, setPersonalAmountError] = useState(false);
  const [personalDescriptionError, setPersonalDescriptionError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [personalSuggestionSource, setPersonalSuggestionSource] = useState<
    { description: string; amount: number; date: string }[]
  >([]);

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

  // Waits for auth, then loads - and again whenever the period changes.
  useFocusEffect(
    useCallback(() => {
      if (!authLoading && canViewPersonalInvestments) loadRoiData();
    }, [canViewPersonalInvestments, loadRoiData, authLoading])
  );

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

  // Filed under the month of the period shown, so the card you are looking
  // at is the one that changes.
  const handleCreatePersonalExpense = async () => {
    const amount = parseFloat(personalAmount);
    const invalidAmount = isNaN(amount) || amount <= 0;
    const missingDescription = !personalDescription.trim();
    setPersonalAmountError(invalidAmount);
    setPersonalDescriptionError(missingDescription);
    if (invalidAmount || missingDescription || submitting) return;
    const periodStart = getPeriodBounds(periodState).start;
    setSubmitting(true);
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
    } catch {
      Alert.alert(t('common.error'), t('common.operationFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canViewPersonalInvestments) return null;
  const invested = (roiData?.total_personal_investment || 0) > 0;

  return (
    <>
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
            {/* A return only on something put in (Л9): with nothing in,
                no percent and no "covered". */}
            {invested && (
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
            )}
          </View>

          {/* ROI Status Indicator - hidden entirely without view_profit,
              since a covered/not-covered verdict is itself derived from
              the profit figure this viewer isn't allowed to see. */}
          {invested && roiData.investment_covered !== null && (
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
              <View style={styles.analysisHeader}>
                <Text style={[styles.aiInsightsTitle, { flex: 1 }]}>{t('roi.analysisTitle')}</Text>
                <InfoButton title={t('roi.analysisTitle')} lines={roiData.analysis.notes} />
              </View>
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
        isSubmitting={submitting}
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

    </>
  );
}

const styles = StyleSheet.create({
  analysisHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  roiPaybackText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
    lineHeight: 21,
    marginBottom: 8,
  },
  aiInsightText: {
    fontSize: 13,
    color: COLORS.textSubtle,
    lineHeight: 20,
    marginBottom: 6,
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
