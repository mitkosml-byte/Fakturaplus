import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/services/api';
import { Summary, ChartDataPoint } from '../../src/types';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { useTranslation } from '../../src/i18n';

const { width } = Dimensions.get('window');
const chartWidth = width - 80;
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

interface SupplierStats {
  supplier: string;
  total_amount: number;
  total_vat: number;
  total_net: number;
  invoice_count: number;
  avg_invoice: number;
}

export default function StatsScreen() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'suppliers'>('overview');
  const [supplierStats, setSupplierStats] = useState<{
    totals: { total_amount: number; total_vat: number; supplier_count: number; invoice_count: number };
    top_10: SupplierStats[];
  } | null>(null);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [summaryData, chartDataResult] = await Promise.all([
        api.getSummary(),
        api.getChartData(period),
      ]);
      setSummary(summaryData);
      setChartData(chartDataResult);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [period]);

  const loadSupplierStats = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const data = await api.getSupplierStatistics();
      setSupplierStats(data);
    } catch (error) {
      console.error('Error loading supplier stats:', error);
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'suppliers' && !supplierStats) {
      loadSupplierStats();
    }
  }, [activeTab, supplierStats, loadSupplierStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'overview') {
      await loadData();
    } else {
      await loadSupplierStats();
    }
    setRefreshing(false);
  }, [loadData, loadSupplierStats, activeTab]);

  const incomeBarData = chartData.map((item) => ({
    value: item.income,
    label: item.label,
    frontColor: '#10B981',
    topLabelComponent: () => (
      <Text style={{ color: '#10B981', fontSize: 10 }}>
        {item.income > 0 ? item.income.toFixed(0) : ''}
      </Text>
    ),
  }));

  const expenseBarData = chartData.map((item) => ({
    value: item.expense,
    label: item.label,
    frontColor: '#EF4444',
    topLabelComponent: () => (
      <Text style={{ color: '#EF4444', fontSize: 10 }}>
        {item.expense > 0 ? item.expense.toFixed(0) : ''}
      </Text>
    ),
  }));

  const vatLineData = chartData.map((item) => ({
    value: item.vat,
    label: item.label,
    dataPointColor: '#8B5CF6',
  }));

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <ScrollView
            style={styles.scrollView}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
          >
            <View style={styles.header}>
              <Text style={styles.title}>{t('stats.title')}</Text>
              <Text style={styles.subtitle}>{t('stats.subtitle')}</Text>
            </View>

            {/* Tab Selector */}
            <View style={styles.tabSelector}>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'overview' && styles.tabButtonActive]}
                onPress={() => setActiveTab('overview')}
              >
                <Ionicons name="bar-chart" size={18} color={activeTab === 'overview' ? 'white' : '#64748B'} />
                <Text style={[styles.tabButtonText, activeTab === 'overview' && styles.tabButtonTextActive]}>
                  {t('stats.overview')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'suppliers' && styles.tabButtonActive]}
                onPress={() => setActiveTab('suppliers')}
              >
                <Ionicons name="business" size={18} color={activeTab === 'suppliers' ? 'white' : '#64748B'} />
                <Text style={[styles.tabButtonText, activeTab === 'suppliers' && styles.tabButtonTextActive]}>
                  {t('stats.suppliers')}
                </Text>
              </TouchableOpacity>
            </View>

            {activeTab === 'overview' ? (
              <>
            {/* Period Selector */}
        <View style={styles.periodSelector}>
          {(['week', 'month', 'year'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodButton, period === p && styles.periodButtonActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodButtonText, period === p && styles.periodButtonTextActive]}>
                {p === 'week' ? t('stats.week') : p === 'month' ? t('stats.month') : t('stats.year')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryGrid}>
          <View style={[styles.summaryCard, { borderLeftColor: '#10B981' }]}>
            <Ionicons name="trending-up" size={24} color="#10B981" />
            <Text style={styles.cardLabel}>{t('stats.totalIncome')}</Text>
            <Text style={[styles.cardValue, { color: '#10B981' }]}>
              {summary?.total_income.toFixed(2) || '0.00'} €
            </Text>
          </View>
          <View style={[styles.summaryCard, { borderLeftColor: '#EF4444' }]}>
            <Ionicons name="trending-down" size={24} color="#EF4444" />
            <Text style={styles.cardLabel}>{t('stats.totalExpense')}</Text>
            <Text style={[styles.cardValue, { color: '#EF4444' }]}>
              {summary?.total_expense.toFixed(2) || '0.00'} €
            </Text>
          </View>
          <View style={[styles.summaryCard, { borderLeftColor: '#8B5CF6' }]}>
            <Ionicons name="calculator" size={24} color="#8B5CF6" />
            <Text style={styles.cardLabel}>{t('stats.vatToPay')}</Text>
            <Text style={[styles.cardValue, { color: (summary?.vat_to_pay || 0) >= 0 ? '#EF4444' : '#10B981' }]}>
              {summary?.vat_to_pay.toFixed(2) || '0.00'} €
            </Text>
          </View>
          <View style={[styles.summaryCard, { borderLeftColor: '#F59E0B' }]}>
            <Ionicons name="wallet" size={24} color="#F59E0B" />
            <Text style={styles.cardLabel}>{t('stats.profitLabel')}</Text>
            <Text style={[styles.cardValue, { color: (summary?.profit || 0) >= 0 ? '#10B981' : '#EF4444' }]}>
              {summary?.profit.toFixed(2) || '0.00'} €
            </Text>
          </View>
        </View>

        {/* Income Chart */}
        <View style={styles.chartContainer}>
          <View style={styles.chartHeader}>
            <Ionicons name="arrow-up-circle" size={24} color="#10B981" />
            <Text style={styles.chartTitle}>{t('stats.income')}</Text>
          </View>
          {incomeBarData.length > 0 ? (
            <BarChart
              data={incomeBarData}
              width={chartWidth}
              height={180}
              barWidth={20}
              spacing={16}
              noOfSections={4}
              barBorderRadius={4}
              frontColor="#10B981"
              yAxisColor="#334155"
              xAxisColor="#334155"
              yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
              xAxisLabelTextStyle={{ color: '#64748B', fontSize: 10 }}
              hideRules
              isAnimated
            />
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>{t('stats.noData')}</Text>
            </View>
          )}
        </View>

        {/* Expense Chart */}
        <View style={styles.chartContainer}>
          <View style={styles.chartHeader}>
            <Ionicons name="arrow-down-circle" size={24} color="#EF4444" />
            <Text style={styles.chartTitle}>{t('home.totalExpenses')}</Text>
          </View>
          {expenseBarData.length > 0 ? (
            <BarChart
              data={expenseBarData}
              width={chartWidth}
              height={180}
              barWidth={20}
              spacing={16}
              noOfSections={4}
              barBorderRadius={4}
              frontColor="#EF4444"
              yAxisColor="#334155"
              xAxisColor="#334155"
              yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
              xAxisLabelTextStyle={{ color: '#64748B', fontSize: 10 }}
              hideRules
              isAnimated
            />
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>{t('stats.noData')}</Text>
            </View>
          )}
        </View>

        {/* VAT Breakdown */}
        <View style={styles.vatBreakdown}>
          <Text style={styles.sectionTitle}>{t('stats.vatBreakdown')}</Text>
          
          <View style={styles.vatRow}>
            <View style={styles.vatItem}>
              <Text style={styles.vatLabel}>{t('stats.vatFromSales')}</Text>
              <Text style={[styles.vatValue, { color: '#EF4444' }]}>
                +{summary?.fiscal_vat.toFixed(2) || '0.00'} €
              </Text>
            </View>
            <View style={styles.vatItem}>
              <Text style={styles.vatLabel}>{t('stats.vatCredit')}</Text>
              <Text style={[styles.vatValue, { color: '#10B981' }]}>
                -{summary?.total_invoice_vat.toFixed(2) || '0.00'} €
              </Text>
            </View>
          </View>

          <View style={styles.vatTotal}>
            <Text style={styles.vatTotalLabel}>{t('stats.vatToPay')}</Text>
            <Text style={[styles.vatTotalValue, { color: (summary?.vat_to_pay || 0) >= 0 ? '#EF4444' : '#10B981' }]}>
              {summary?.vat_to_pay.toFixed(2) || '0.00'} €
            </Text>
          </View>
        </View>

        {/* Additional Stats */}
        <View style={styles.additionalStats}>
          <Text style={styles.sectionTitle}>{t('stats.additionalInfo')}</Text>
          
          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Ionicons name="receipt" size={20} color="#8B5CF6" />
              <Text style={styles.statLabel}>{t('stats.invoiceCount')}</Text>
              <Text style={styles.statValue}>{summary?.invoice_count || 0}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="cash" size={20} color="#10B981" />
              <Text style={styles.statLabel}>{t('home.fiscalRevenue')}</Text>
              <Text style={styles.statValue}>{summary?.total_fiscal_revenue.toFixed(0) || 0} €</Text>
            </View>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Ionicons name="wallet" size={20} color="#F59E0B" />
              <Text style={styles.statLabel}>{t('home.pocket')}</Text>
              <Text style={styles.statValue}>{summary?.total_pocket_money.toFixed(0) || 0} €</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="remove-circle" size={20} color="#EF4444" />
              <Text style={styles.statLabel}>{t('stats.expensesNoInvoice')}</Text>
              <Text style={styles.statValue}>{summary?.total_non_invoice_expenses.toFixed(0) || 0} €</Text>
            </View>
          </View>
        </View>

            <View style={{ height: 40 }} />
              </>
            ) : (
              /* Suppliers Tab */
              <View style={styles.suppliersContainer}>
                {loadingSuppliers ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#8B5CF6" />
                    <Text style={styles.loadingText}>Зареждане на данни...</Text>
                  </View>
                ) : supplierStats ? (
                  <>
                    {/* Totals Summary */}
                    <View style={styles.supplierTotalsCard}>
                      <Text style={styles.supplierTotalsTitle}>Общо за текущия месец</Text>
                      <View style={styles.supplierTotalsRow}>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierStats.totals.total_amount.toFixed(2)} €
                          </Text>
                          <Text style={styles.supplierTotalLabel}>Обща сума</Text>
                        </View>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierStats.totals.total_vat.toFixed(2)} €
                          </Text>
                          <Text style={styles.supplierTotalLabel}>ДДС</Text>
                        </View>
                      </View>
                      <View style={styles.supplierTotalsRow}>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierStats.totals.supplier_count}
                          </Text>
                          <Text style={styles.supplierTotalLabel}>Доставчици</Text>
                        </View>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierStats.totals.invoice_count}
                          </Text>
                          <Text style={styles.supplierTotalLabel}>Фактури</Text>
                        </View>
                      </View>
                    </View>

                    {/* Top 10 Suppliers */}
                    <View style={styles.topSuppliersCard}>
                      <View style={styles.topSuppliersHeader}>
                        <Ionicons name="trophy" size={24} color="#F59E0B" />
                        <Text style={styles.topSuppliersTitle}>Топ 10 Доставчици</Text>
                      </View>
                      
                      {supplierStats.top_10.length > 0 ? (
                        supplierStats.top_10.map((supplier, index) => (
                          <View key={supplier.supplier} style={styles.supplierItem}>
                            <View style={styles.supplierRank}>
                              <Text style={[
                                styles.supplierRankText,
                                index < 3 && { color: index === 0 ? '#F59E0B' : index === 1 ? '#94A3B8' : '#CD7F32' }
                              ]}>
                                #{index + 1}
                              </Text>
                            </View>
                            <View style={styles.supplierInfo}>
                              <Text style={styles.supplierName} numberOfLines={1}>
                                {supplier.supplier}
                              </Text>
                              <Text style={styles.supplierMeta}>
                                {supplier.invoice_count} фактури • Ср. {supplier.avg_invoice.toFixed(0)}€
                              </Text>
                            </View>
                            <View style={styles.supplierAmounts}>
                              <Text style={styles.supplierAmount}>
                                {supplier.total_amount.toFixed(2)} €
                              </Text>
                              <Text style={styles.supplierVat}>
                                ДДС: {supplier.total_vat.toFixed(2)} €
                              </Text>
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.noDataText}>Няма данни за доставчици</Text>
                      )}
                    </View>
                  </>
                ) : (
                  <View style={styles.noDataContainer}>
                    <Ionicons name="business-outline" size={48} color="#64748B" />
                    <Text style={styles.noDataText}>Няма данни за доставчици</Text>
                  </View>
                )}
                <View style={{ height: 40 }} />
              </View>
            )}
          </ScrollView>
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
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  periodButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  periodButtonText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  periodButtonTextActive: {
    color: 'white',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    width: '47%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  cardLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 8,
  },
  cardValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
  },
  chartContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  noDataContainer: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    color: '#64748B',
    fontSize: 14,
  },
  vatBreakdown: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  vatRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  vatItem: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
  },
  vatLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
  },
  vatValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  vatTotal: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vatTotalLabel: {
    fontSize: 14,
    color: 'white',
    fontWeight: '500',
  },
  vatTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  additionalStats: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
  },
  statRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statItem: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 4,
  },
  tabSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  tabButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  tabButtonText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  tabButtonTextActive: {
    color: 'white',
  },
  suppliersContainer: {
    flex: 1,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: '#64748B',
    marginTop: 12,
  },
  supplierTotalsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  supplierTotalsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
    textAlign: 'center',
  },
  supplierTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  supplierTotalItem: {
    alignItems: 'center',
  },
  supplierTotalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  supplierTotalLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  topSuppliersCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
  },
  topSuppliersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  topSuppliersTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  supplierItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  supplierRank: {
    width: 32,
    alignItems: 'center',
  },
  supplierRankText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#64748B',
  },
  supplierInfo: {
    flex: 1,
    marginLeft: 8,
  },
  supplierName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  supplierMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  supplierAmounts: {
    alignItems: 'flex-end',
  },
  supplierAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#10B981',
  },
  supplierVat: {
    fontSize: 11,
    color: '#64748B',
  },
  noDataContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDataText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 12,
  },
});
