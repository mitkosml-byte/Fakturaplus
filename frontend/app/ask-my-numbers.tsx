import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { parseISO, format } from 'date-fns';
import { api } from '../src/services/api';
import { BusinessChatDigest } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

// Module 4 Finding #3: a plain-language chat surface over the company's
// own stored data. Explicitly NOT a general chatbot - it never talks to
// NAP or any outside system. The backend computes the actual numbers
// (company-scoped, permission-redacted exactly like /statistics/summary)
// BEFORE asking the model to phrase an answer, so what the model can say
// is bounded by what this screen renders right below it - never a bare
// verdict with no numbers behind it.
type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; digest: BusinessChatDigest }
  | { id: string; role: 'error'; text: string };

export default function AskMyNumbersScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const monthLabel = (label: string) => {
    try {
      return format(parseISO(`${label}-01`), 'LLLL yyyy', { locale: dateLocale });
    } catch {
      return label;
    }
  };

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    // Built from the messages already on screen, BEFORE this question is
    // added - without this, every message was its own context-free
    // request and a follow-up ("сравни с него", "ами миналата седмица?")
    // had nothing to refer back to. Capped to the last 12 turns, matching
    // the backend's own cap, so a long on-screen chat doesn't grow the
    // request payload (and the model's token cost) without bound.
    const history = messages
      .filter((m): m is Extract<ChatMessage, { role: 'user' | 'assistant' }> => m.role === 'user' || m.role === 'assistant')
      .slice(-12)
      .map((m) => ({ role: m.role, text: m.text }));
    setSending(true);
    setText('');
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: trimmed }]);
    try {
      const data = await api.askMyNumbers(trimmed, history);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: data.answer, digest: data.digest }]);
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'error', text: error?.message || t('askMyNumbers.genericError') },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  if (!hasPermission('view_statistics')) {
    return <AccessDenied />;
  }

  const suggestions = [
    t('askMyNumbers.suggestion1'),
    t('askMyNumbers.suggestion2'),
    t('askMyNumbers.suggestion3'),
    t('askMyNumbers.suggestion4'),
  ];

  return (
    <ScreenEnter>
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="white" />
              </TouchableOpacity>
              <Text style={styles.title} numberOfLines={1}>{t('askMyNumbers.title')}</Text>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.disclaimerBanner}>
              <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.disclaimerText}>{t('askMyNumbers.disclaimer')}</Text>
            </View>

            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ flex: 1 }}
              keyboardVerticalOffset={0}
            >
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16, flexGrow: 1 }}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="chatbubbles-outline" size={36} color={COLORS.textMuted} />
                    <Text style={styles.emptyTitle}>{t('askMyNumbers.emptyTitle')}</Text>
                    <View style={styles.suggestionsColumn}>
                      {suggestions.map((s) => (
                        <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => send(s)}>
                          <Text style={styles.suggestionChipText}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                }
                renderItem={({ item }) => {
                  if (item.role === 'user') {
                    return (
                      <View style={[styles.bubbleRow, styles.bubbleRowMine]}>
                        <View style={[styles.bubble, styles.bubbleMine]}>
                          <Text style={styles.bubbleText}>{item.text}</Text>
                        </View>
                      </View>
                    );
                  }
                  if (item.role === 'error') {
                    return (
                      <View style={[styles.bubbleRow, styles.bubbleRowTheirs]}>
                        <View style={[styles.bubble, styles.bubbleError]}>
                          <Text style={styles.bubbleText}>{item.text}</Text>
                        </View>
                      </View>
                    );
                  }
                  const d = item.digest;
                  return (
                    <View style={[styles.bubbleRow, styles.bubbleRowTheirs]}>
                      <View style={{ maxWidth: '88%' }}>
                        <View style={[styles.bubble, styles.bubbleTheirs]}>
                          <Text style={styles.bubbleText}>{item.text}</Text>
                        </View>

                        {/* Always rendered alongside the answer, never behind
                            an extra tap - the North Star principle this
                            feature follows ("always show the numbers behind
                            the answer, never a bare verdict"). */}
                        <View style={styles.digestCard}>
                          <Text style={styles.digestTitle}>{t('askMyNumbers.numbersTitle')}</Text>

                          <View style={styles.digestPeriodsRow}>
                            {[
                              { key: 'this_month', label: t('askMyNumbers.thisMonth'), data: d.this_month },
                              { key: 'last_month', label: t('askMyNumbers.lastMonth'), data: d.last_month },
                            ].map(({ key, label, data }) => (
                              <View key={key} style={styles.digestPeriod}>
                                <Text style={styles.digestPeriodLabel}>{label} ({monthLabel(data.label)})</Text>
                                <Text style={styles.digestRow}>{t('askMyNumbers.revenue')}: {data.revenue.toFixed(2)} €</Text>
                                <Text style={styles.digestRow}>{t('askMyNumbers.expenses')}: {data.expenses.toFixed(2)} €</Text>
                                <Text style={styles.digestRow}>
                                  {t('askMyNumbers.profit')}: {data.profit === null ? t('askMyNumbers.profitHidden') : `${data.profit.toFixed(2)} €`}
                                </Text>
                              </View>
                            ))}
                          </View>

                          {d.top_expenses_this_month.length > 0 && (
                            <View style={styles.digestSection}>
                              <Text style={styles.digestSectionLabel}>{t('askMyNumbers.topExpenses')}</Text>
                              {d.top_expenses_this_month.slice(0, 5).map((e, i) => (
                                <Text key={`${e.name}-${i}`} style={styles.digestRow}>
                                  {e.name} — {e.amount.toFixed(2)} €
                                </Text>
                              ))}
                            </View>
                          )}

                          {d.unpaid_invoices.count > 0 && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.unpaid')
                                .replace('{count}', String(d.unpaid_invoices.count))
                                .replace('{overdue}', String(d.unpaid_invoices.overdue_count))
                                .replace('{amount}', d.unpaid_invoices.total_unpaid_amount.toFixed(2))}
                            </Text>
                          )}

                          {d.receivables && d.receivables.unpaid_count > 0 && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.receivables')
                                .replace('{count}', String(d.receivables.unpaid_count))
                                .replace('{overdue}', String(d.receivables.overdue_count))
                                .replace('{amount}', d.receivables.total_owed.toFixed(2))}
                            </Text>
                          )}

                          {d.budget && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.budget')
                                .replace('{percent}', String(d.budget.percent_used))
                                .replace('{limit}', d.budget.expense_limit.toFixed(2))}
                            </Text>
                          )}

                          <Text style={styles.digestRow}>
                            {t('askMyNumbers.vatDue').replace('{amount}', d.vat_due_this_month.toFixed(2))}
                          </Text>

                          {d.forecast.revenue && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.forecastRevenue')
                                .replace('{amount}', d.forecast.revenue.next_month_predicted.toFixed(2))
                                .replace('{note}', d.forecast.revenue.trend === 'insufficient_data' ? t('askMyNumbers.forecastInsufficientData') : '')}
                            </Text>
                          )}
                          {d.forecast.expenses && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.forecastExpenses')
                                .replace('{amount}', d.forecast.expenses.next_month_predicted.toFixed(2))
                                .replace('{note}', d.forecast.expenses.trend === 'insufficient_data' ? t('askMyNumbers.forecastInsufficientData') : '')}
                            </Text>
                          )}

                          {d.roi && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.roi')
                                .replace('{roiPercent}', d.roi.roi_percent === null ? '—' : String(d.roi.roi_percent))
                                .replace('{investment}', d.roi.total_personal_investment.toFixed(2))}
                            </Text>
                          )}

                          {d.assets && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.assets')
                                .replace('{count}', String(d.assets.active_count))
                                .replace('{value}', d.assets.total_net_book_value.toFixed(2))}
                            </Text>
                          )}

                          {d.payroll && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.payroll')
                                .replace('{count}', String(d.payroll.employee_count))
                                .replace('{amount}', d.payroll.total_employer_cost.toFixed(2))}
                            </Text>
                          )}

                          <Text style={styles.digestRow}>
                            {t('askMyNumbers.scanCredits').replace('{count}', String(d.scan_credits.total_remaining))}
                          </Text>

                          {d.price_alerts_unread_count > 0 && (
                            <Text style={styles.digestRow}>
                              {t('askMyNumbers.priceAlerts').replace('{count}', String(d.price_alerts_unread_count))}
                            </Text>
                          )}

                          {d.reorder_nudges.length > 0 && (
                            <View style={styles.digestSection}>
                              {d.reorder_nudges.map((n, i) => (
                                <Text key={`${n.item_name}-${i}`} style={styles.digestRow}>
                                  {t('askMyNumbers.reorderNudge')
                                    .replace('{item}', n.item_name)
                                    .replace('{days}', String(n.median_days_between))
                                    .replace('{since}', String(n.days_since_last))}
                                </Text>
                              ))}
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                }}
              />

              {sending && (
                <View style={styles.typingRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                </View>
              )}

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={text}
                  onChangeText={setText}
                  placeholder={t('askMyNumbers.placeholder')}
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  onSubmitEditing={() => send(text)}
                />
                <TouchableOpacity style={styles.sendButton} onPress={() => send(text)} disabled={sending || !text.trim()}>
                  {sending ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="send" size={20} color="white" />}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  disclaimerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disclaimerText: { flex: 1, fontSize: 11, color: COLORS.textSecondary },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
  emptyTitle: { fontSize: 14, color: COLORS.textMuted },
  suggestionsColumn: { gap: 10, marginTop: 8, width: '100%' },
  suggestionChip: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  suggestionChipText: { color: 'white', fontSize: 13 },
  bubbleRow: { flexDirection: 'row', marginBottom: 12 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  bubbleError: { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: COLORS.danger, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: 'white' },
  digestCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  digestTitle: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, textTransform: 'uppercase' },
  digestPeriodsRow: { flexDirection: 'row', gap: 16, marginBottom: 6 },
  digestPeriod: { flex: 1 },
  digestPeriodLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 4 },
  digestSection: { marginTop: 8 },
  digestSectionLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 4 },
  digestRow: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  typingRow: { paddingHorizontal: 16, paddingBottom: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: 'white',
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
