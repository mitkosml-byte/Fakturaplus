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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/services/api';
import { Summary, ChartDataPoint, SupplierOverviewResponse, SupplierStats, ChartType, SupplierDetailedResponse } from '../../src/types';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';
import { useTranslation } from '../../src/i18n';

const { width } = Dimensions.get('window');
const chartWidth = width - 80;
const pieChartRadius = (width - 80) / 3;
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

// Color palette for charts
const CHART_COLORS = [
  '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'
];

export default function StatsScreen() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'suppliers' | 'items'>('overview');
  
  // Advanced supplier stats
  const [supplierOverview, setSupplierOverview] = useState<SupplierOverviewResponse | null>(null);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [supplierChartType, setSupplierChartType] = useState<ChartType>('pie');
  const [supplierRankingType, setSupplierRankingType] = useState<'amount' | 'frequency' | 'avg'>('amount');
  
  // Supplier detail modal
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [supplierDetail, setSupplierDetail] = useState<SupplierDetailedResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // Item statistics
  const [itemStats, setItemStats] = useState<any>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [priceAlerts, setPriceAlerts] = useState<any[]>([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [itemRankingType, setItemRankingType] = useState<'quantity' | 'value' | 'frequency'>('value');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [itemPriceHistory, setItemPriceHistory] = useState<any>(null);
  const [itemBySupplier, setItemBySupplier] = useState<any>(null);
  const [loadingItemDetail, setLoadingItemDetail] = useState(false);

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
      const data = await api.getSupplierOverview();
      setSupplierOverview(data);
    } catch (error) {
      console.error('Error loading supplier stats:', error);
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  const loadSupplierDetail = useCallback(async (supplierName: string) => {
    setLoadingDetail(true);
    try {
      const data = await api.getSupplierDetailed(supplierName);
      setSupplierDetail(data);
    } catch (error) {
      console.error('Error loading supplier detail:', error);
    } finally {
      setLoadingDetail(false);
    }
  }, []);
  
  // Item statistics functions
  const loadItemStats = useCallback(async () => {
    setLoadingItems(true);
    try {
      const [statsData, alertsData] = await Promise.all([
        api.getItemStatistics(),
        api.getPriceAlerts()
      ]);
      setItemStats(statsData);
      setPriceAlerts(alertsData.alerts || []);
      setUnreadAlerts(alertsData.unread_count || 0);
    } catch (error) {
      console.error('Error loading item stats:', error);
    } finally {
      setLoadingItems(false);
    }
  }, []);
  
  const loadItemDetail = useCallback(async (itemName: string) => {
    setLoadingItemDetail(true);
    try {
      const [historyData, supplierData] = await Promise.all([
        api.getItemPriceHistory(itemName),
        api.getItemBySupplier(itemName)
      ]);
      setItemPriceHistory(historyData);
      setItemBySupplier(supplierData);
    } catch (error) {
      console.error('Error loading item detail:', error);
    } finally {
      setLoadingItemDetail(false);
    }
  }, []);
  
  const markAlertAsRead = async (alertId: string) => {
    try {
      await api.updatePriceAlert(alertId, 'read');
      setPriceAlerts(prev => prev.map(a => a.id === alertId ? {...a, status: 'read'} : a));
      setUnreadAlerts(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error updating alert:', error);
    }
  };
  
  const dismissAlert = async (alertId: string) => {
    try {
      await api.updatePriceAlert(alertId, 'dismissed');
      setPriceAlerts(prev => prev.filter(a => a.id !== alertId));
      setUnreadAlerts(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error dismissing alert:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'suppliers' && !supplierOverview) {
      loadSupplierStats();
    }
  }, [activeTab, supplierOverview, loadSupplierStats]);
  
  useEffect(() => {
    if (activeTab === 'items' && !itemStats) {
      loadItemStats();
    }
  }, [activeTab, itemStats, loadItemStats]);

  useEffect(() => {
    if (selectedSupplier) {
      loadSupplierDetail(selectedSupplier);
    }
  }, [selectedSupplier, loadSupplierDetail]);
  
  useEffect(() => {
    if (selectedItem) {
      loadItemDetail(selectedItem);
    }
  }, [selectedItem, loadItemDetail]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'overview') {
      await loadData();
    } else if (activeTab === 'suppliers') {
      await loadSupplierStats();
    } else {
      await loadItemStats();
    }
    setRefreshing(false);
  }, [loadData, loadSupplierStats, loadItemStats, activeTab]);
  
  // Get current item ranking
  const getCurrentItemRanking = () => {
    if (!itemStats) return [];
    switch (itemRankingType) {
      case 'quantity':
        return itemStats.top_by_quantity || [];
      case 'frequency':
        return itemStats.top_by_frequency || [];
      default:
        return itemStats.top_by_value || [];
    }
  };

  // Chart data for overview
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

  // Get current ranking data
  const getCurrentRanking = (): SupplierStats[] => {
    if (!supplierOverview) return [];
    switch (supplierRankingType) {
      case 'frequency':
        return supplierOverview.top_by_frequency;
      case 'avg':
        return supplierOverview.top_by_avg;
      default:
        return supplierOverview.top_by_amount;
    }
  };

  // Prepare pie chart data
  const getPieChartData = () => {
    const ranking = getCurrentRanking();
    const top5 = ranking.slice(0, 5);
    const othersTotal = ranking.slice(5).reduce((sum, s) => sum + s.total_amount, 0);
    
    const data = top5.map((supplier, index) => ({
      value: supplier.total_amount,
      color: CHART_COLORS[index],
      text: `${supplier.dependency_percent.toFixed(0)}%`,
      shiftTextX: -8,
      shiftTextY: 0,
    }));
    
    if (othersTotal > 0) {
      data.push({
        value: othersTotal,
        color: '#64748B',
        text: '',
        shiftTextX: 0,
        shiftTextY: 0,
      });
    }
    
    return data;
  };

  // Prepare bar chart data for suppliers
  const getSupplierBarData = () => {
    const ranking = getCurrentRanking().slice(0, 7);
    return ranking.map((supplier, index) => ({
      value: supplierRankingType === 'frequency' ? supplier.invoice_count : 
             supplierRankingType === 'avg' ? supplier.avg_invoice : supplier.total_amount,
      label: supplier.supplier.substring(0, 6),
      frontColor: CHART_COLORS[index % CHART_COLORS.length],
    }));
  };

  // Prepare line chart data for supplier monthly trend
  const getSupplierLineData = () => {
    if (!supplierDetail?.monthly_trend) return [];
    return supplierDetail.monthly_trend.map(m => ({
      value: m.amount,
      label: m.month.substring(5),
      dataPointColor: '#8B5CF6',
    }));
  };

  // Render chart type selector
  const renderChartTypeSelector = () => (
    <View style={styles.chartTypeSelector}>
      <TouchableOpacity
        style={[styles.chartTypeButton, supplierChartType === 'pie' && styles.chartTypeButtonActive]}
        onPress={() => setSupplierChartType('pie')}
      >
        <Ionicons name="pie-chart" size={18} color={supplierChartType === 'pie' ? 'white' : '#64748B'} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.chartTypeButton, supplierChartType === 'bar' && styles.chartTypeButtonActive]}
        onPress={() => setSupplierChartType('bar')}
      >
        <Ionicons name="bar-chart" size={18} color={supplierChartType === 'bar' ? 'white' : '#64748B'} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.chartTypeButton, supplierChartType === 'line' && styles.chartTypeButtonActive]}
        onPress={() => setSupplierChartType('line')}
      >
        <Ionicons name="trending-up" size={18} color={supplierChartType === 'line' ? 'white' : '#64748B'} />
      </TouchableOpacity>
    </View>
  );

  // Render supplier detail modal
  const renderSupplierDetailModal = () => (
    <Modal
      visible={!!selectedSupplier}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        setSelectedSupplier(null);
        setSupplierDetail(null);
      }}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity 
            style={styles.modalCloseButton}
            onPress={() => {
              setSelectedSupplier(null);
              setSupplierDetail(null);
            }}
          >
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>{selectedSupplier}</Text>
          <View style={{ width: 40 }} />
        </View>

        {loadingDetail ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator size="large" color="#8B5CF6" />
          </View>
        ) : supplierDetail?.found ? (
          <ScrollView style={styles.modalContent}>
            {/* Overview Card */}
            <View style={styles.detailCard}>
              <Text style={styles.detailCardTitle}>{t('stats.supplierOverview')}</Text>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.total_amount.toFixed(2)} €</Text>
                  <Text style={styles.detailLabel}>{t('stats.totalAmount')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.invoice_count}</Text>
                  <Text style={styles.detailLabel}>{t('stats.invoiceCount')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.avg_invoice.toFixed(2)} €</Text>
                  <Text style={styles.detailLabel}>{t('stats.avgInvoice')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{supplierDetail.overview?.total_vat.toFixed(2)} €</Text>
                  <Text style={styles.detailLabel}>{t('stats.vat')}</Text>
                </View>
              </View>
              
              <View style={styles.detailDates}>
                <View style={styles.detailDateItem}>
                  <Ionicons name="calendar-outline" size={16} color="#64748B" />
                  <Text style={styles.detailDateLabel}>{t('stats.firstDelivery')}: </Text>
                  <Text style={styles.detailDateValue}>{supplierDetail.overview?.first_delivery || t('stats.noValue')}</Text>
                </View>
                <View style={styles.detailDateItem}>
                  <Ionicons name="time-outline" size={16} color="#64748B" />
                  <Text style={styles.detailDateLabel}>{t('stats.lastDelivery')}: </Text>
                  <Text style={styles.detailDateValue}>{supplierDetail.overview?.last_delivery || '-'}</Text>
                </View>
              </View>
              
              <View style={[
                styles.statusBadge, 
                { backgroundColor: supplierDetail.overview?.is_active ? '#10B98120' : '#EF444420' }
              ]}>
                <Ionicons 
                  name={supplierDetail.overview?.is_active ? "checkmark-circle" : "alert-circle"} 
                  size={16} 
                  color={supplierDetail.overview?.is_active ? '#10B981' : '#EF4444'} 
                />
                <Text style={[
                  styles.statusText, 
                  { color: supplierDetail.overview?.is_active ? '#10B981' : '#EF4444' }
                ]}>
                  {supplierDetail.overview?.is_active ? t('stats.activeSupplier') : `${t('stats.inactiveSupplier')} (${supplierDetail.overview?.days_inactive} ${t('stats.days')})`}
                </Text>
              </View>
            </View>

            {/* Monthly Trend Chart */}
            {supplierDetail.monthly_trend && supplierDetail.monthly_trend.length > 0 && (
              <View style={styles.detailCard}>
                <Text style={styles.detailCardTitle}>{t('stats.monthlyTrend')}</Text>
                <LineChart
                  data={getSupplierLineData()}
                  width={chartWidth - 20}
                  height={150}
                  color="#8B5CF6"
                  thickness={2}
                  dataPointsColor="#8B5CF6"
                  yAxisColor="#334155"
                  xAxisColor="#334155"
                  yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                  hideRules
                  isAnimated
                  curved
                />
              </View>
            )}

            {/* Anomalies */}
            {supplierDetail.anomalies && supplierDetail.anomalies.length > 0 && (
              <View style={styles.detailCard}>
                <View style={styles.anomalyHeader}>
                  <Ionicons name="warning" size={20} color="#F59E0B" />
                  <Text style={styles.detailCardTitle}>{t('stats.anomalies')}</Text>
                </View>
                {supplierDetail.anomalies.map((anomaly, index) => (
                  <View key={index} style={styles.anomalyItem}>
                    <View>
                      <Text style={styles.anomalyInvoice}>№{anomaly.invoice_number}</Text>
                      <Text style={styles.anomalyDate}>{anomaly.date}</Text>
                    </View>
                    <View style={styles.anomalyAmount}>
                      <Text style={styles.anomalyValue}>{anomaly.amount.toFixed(2)} €</Text>
                      <Text style={styles.anomalyDeviation}>+{anomaly.deviation_percent}%</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Recent Invoices */}
            {supplierDetail.recent_invoices && supplierDetail.recent_invoices.length > 0 && (
              <View style={styles.detailCard}>
                <Text style={styles.detailCardTitle}>{t('stats.recentInvoices')}</Text>
                {supplierDetail.recent_invoices.map((invoice, index) => (
                  <View key={index} style={styles.recentInvoiceItem}>
                    <View>
                      <Text style={styles.recentInvoiceNumber}>№{invoice.invoice_number}</Text>
                      <Text style={styles.recentInvoiceDate}>{invoice.date}</Text>
                    </View>
                    <Text style={styles.recentInvoiceAmount}>{invoice.total_amount.toFixed(2)} €</Text>
                  </View>
                ))}
              </View>
            )}
            
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <View style={styles.modalLoading}>
            <Ionicons name="alert-circle-outline" size={48} color="#64748B" />
            <Text style={styles.noDataText}>{t('stats.noSupplierData')}</Text>
          </View>
        )}
      </View>
    </Modal>
  );

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
                <Ionicons name="bar-chart" size={16} color={activeTab === 'overview' ? 'white' : '#64748B'} />
                <Text style={[styles.tabButtonText, activeTab === 'overview' && styles.tabButtonTextActive]}>
                  {t('stats.overview')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'suppliers' && styles.tabButtonActive]}
                onPress={() => setActiveTab('suppliers')}
              >
                <Ionicons name="business" size={16} color={activeTab === 'suppliers' ? 'white' : '#64748B'} />
                <Text style={[styles.tabButtonText, activeTab === 'suppliers' && styles.tabButtonTextActive]}>
                  {t('stats.suppliers')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === 'items' && styles.tabButtonActive]}
                onPress={() => setActiveTab('items')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="pricetags" size={16} color={activeTab === 'items' ? 'white' : '#64748B'} />
                  {unreadAlerts > 0 && (
                    <View style={styles.alertBadge}>
                      <Text style={styles.alertBadgeText}>{unreadAlerts}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.tabButtonText, activeTab === 'items' && styles.tabButtonTextActive]}>
                  {t('stats.items')}
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
            ) : activeTab === 'suppliers' ? (
              /* ========== ADVANCED SUPPLIERS TAB ========== */
              <View style={styles.suppliersContainer}>
                {loadingSuppliers ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#8B5CF6" />
                    <Text style={styles.loadingText}>{t('stats.loadingData')}</Text>
                  </View>
                ) : supplierOverview ? (
                  <>
                    {/* Executive Summary */}
                    <View style={styles.executiveSummaryCard}>
                      <View style={styles.execSummaryHeader}>
                        <Ionicons name="analytics" size={24} color="#8B5CF6" />
                        <Text style={styles.execSummaryTitle}>{t('stats.executiveSummary')}</Text>
                      </View>
                      
                      <View style={styles.execSummaryGrid}>
                        <View style={styles.execItem}>
                          <Text style={styles.execValue}>{supplierOverview.executive_summary.total_suppliers}</Text>
                          <Text style={styles.execLabel}>{t('stats.totalSuppliers')}</Text>
                        </View>
                        <View style={styles.execItem}>
                          <Text style={[styles.execValue, { color: '#10B981' }]}>
                            {supplierOverview.executive_summary.active_suppliers}
                          </Text>
                          <Text style={styles.execLabel}>{t('stats.activeSuppliers')}</Text>
                        </View>
                        <View style={styles.execItem}>
                          <Text style={[styles.execValue, { color: '#EF4444' }]}>
                            {supplierOverview.executive_summary.inactive_suppliers}
                          </Text>
                          <Text style={styles.execLabel}>{t('stats.inactiveSuppliers')}</Text>
                        </View>
                      </View>
                      
                      {/* Concentration indicators */}
                      <View style={styles.concentrationRow}>
                        <View style={styles.concentrationItem}>
                          <Text style={styles.concentrationLabel}>{t('stats.top3Concentration')}</Text>
                          <View style={styles.concentrationBar}>
                            <View style={[styles.concentrationFill, { 
                              width: `${Math.min(supplierOverview.executive_summary.top_3_concentration, 100)}%`,
                              backgroundColor: supplierOverview.executive_summary.top_3_concentration > 70 ? '#EF4444' : '#10B981'
                            }]} />
                          </View>
                          <Text style={styles.concentrationValue}>
                            {supplierOverview.executive_summary.top_3_concentration.toFixed(1)}%
                          </Text>
                        </View>
                      </View>
                      
                      {/* High dependency alert */}
                      {supplierOverview.executive_summary.high_dependency_count > 0 && (
                        <View style={styles.alertBanner}>
                          <Ionicons name="warning" size={18} color="#F59E0B" />
                          <Text style={styles.alertText}>
                            {supplierOverview.executive_summary.high_dependency_count} {t('stats.highDependencyAlert')}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Totals Summary */}
                    <View style={styles.supplierTotalsCard}>
                      <Text style={styles.supplierTotalsTitle}>{t('stats.currentMonthTotal')}</Text>
                      <View style={styles.supplierTotalsRow}>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.total_amount.toFixed(2)} €
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.totalAmount')}</Text>
                        </View>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.total_vat.toFixed(2)} €
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.vat')}</Text>
                        </View>
                      </View>
                      <View style={styles.supplierTotalsRow}>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.supplier_count}
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.supplierCount')}</Text>
                        </View>
                        <View style={styles.supplierTotalItem}>
                          <Text style={styles.supplierTotalValue}>
                            {supplierOverview.totals.invoice_count}
                          </Text>
                          <Text style={styles.supplierTotalLabel}>{t('stats.invoiceCount')}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Chart Type & Ranking Selectors */}
                    <View style={styles.chartControlsContainer}>
                      {renderChartTypeSelector()}
                      
                      <View style={styles.rankingSelector}>
                        <TouchableOpacity
                          style={[styles.rankingButton, supplierRankingType === 'amount' && styles.rankingButtonActive]}
                          onPress={() => setSupplierRankingType('amount')}
                        >
                          <Text style={[styles.rankingButtonText, supplierRankingType === 'amount' && styles.rankingButtonTextActive]}>
                            {t('stats.byAmount')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.rankingButton, supplierRankingType === 'frequency' && styles.rankingButtonActive]}
                          onPress={() => setSupplierRankingType('frequency')}
                        >
                          <Text style={[styles.rankingButtonText, supplierRankingType === 'frequency' && styles.rankingButtonTextActive]}>
                            {t('stats.byFrequency')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.rankingButton, supplierRankingType === 'avg' && styles.rankingButtonActive]}
                          onPress={() => setSupplierRankingType('avg')}
                        >
                          <Text style={[styles.rankingButtonText, supplierRankingType === 'avg' && styles.rankingButtonTextActive]}>
                            {t('stats.byAvg')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Chart Display */}
                    <View style={styles.chartContainer}>
                      <View style={styles.chartHeader}>
                        <Ionicons name="trophy" size={24} color="#F59E0B" />
                        <Text style={styles.chartTitle}>{t('stats.top10')}</Text>
                      </View>
                      
                      {supplierChartType === 'pie' && getPieChartData().length > 0 && (
                        <View style={styles.pieChartContainer}>
                          <PieChart
                            data={getPieChartData()}
                            radius={pieChartRadius}
                            innerRadius={pieChartRadius * 0.5}
                            centerLabelComponent={() => (
                              <View style={styles.pieCenter}>
                                <Text style={styles.pieCenterValue}>
                                  {supplierOverview.totals.total_amount.toFixed(0)}€
                                </Text>
                                <Text style={styles.pieCenterLabel}>{t('stats.totalAmount')}</Text>
                              </View>
                            )}
                            showText
                            textColor="white"
                            textSize={10}
                          />
                          
                          {/* Legend */}
                          <View style={styles.legendContainer}>
                            {getCurrentRanking().slice(0, 5).map((supplier, index) => (
                              <TouchableOpacity 
                                key={supplier.supplier} 
                                style={styles.legendItem}
                                onPress={() => setSelectedSupplier(supplier.supplier)}
                              >
                                <View style={[styles.legendColor, { backgroundColor: CHART_COLORS[index] }]} />
                                <Text style={styles.legendText} numberOfLines={1}>{supplier.supplier}</Text>
                                <Text style={styles.legendValue}>{supplier.dependency_percent.toFixed(0)}%</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      )}
                      
                      {supplierChartType === 'bar' && getSupplierBarData().length > 0 && (
                        <BarChart
                          data={getSupplierBarData()}
                          width={chartWidth}
                          height={200}
                          barWidth={28}
                          spacing={12}
                          noOfSections={4}
                          barBorderRadius={4}
                          yAxisColor="#334155"
                          xAxisColor="#334155"
                          yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                          xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                          hideRules
                          isAnimated
                        />
                      )}
                      
                      {supplierChartType === 'line' && getSupplierBarData().length > 0 && (
                        <LineChart
                          data={getSupplierBarData().map(d => ({ value: d.value, label: d.label, dataPointColor: '#8B5CF6' }))}
                          width={chartWidth}
                          height={200}
                          color="#8B5CF6"
                          thickness={3}
                          dataPointsColor="#8B5CF6"
                          yAxisColor="#334155"
                          xAxisColor="#334155"
                          yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                          xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                          hideRules
                          isAnimated
                          curved
                        />
                      )}
                    </View>

                    {/* Top Suppliers List */}
                    <View style={styles.topSuppliersCard}>
                      <View style={styles.topSuppliersHeader}>
                        <Ionicons name="list" size={24} color="#8B5CF6" />
                        <Text style={styles.topSuppliersTitle}>
                          {supplierRankingType === 'amount' ? t('stats.topByAmount') : 
                           supplierRankingType === 'frequency' ? t('stats.topByFrequency') : t('stats.topByAvg')}
                        </Text>
                      </View>
                      
                      {getCurrentRanking().length > 0 ? (
                        getCurrentRanking().map((supplier, index) => (
                          <TouchableOpacity 
                            key={supplier.supplier} 
                            style={styles.supplierItem}
                            onPress={() => setSelectedSupplier(supplier.supplier)}
                          >
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
                                {supplier.invoice_count} {t('stats.invoices')} • {t('stats.avgShort')} {supplier.avg_invoice.toFixed(0)}€
                              </Text>
                            </View>
                            <View style={styles.supplierAmounts}>
                              <Text style={styles.supplierAmount}>
                                {supplier.total_amount.toFixed(2)} €
                              </Text>
                              <View style={styles.dependencyBadge}>
                                <Text style={[
                                  styles.dependencyText,
                                  supplier.dependency_percent > 30 && { color: '#EF4444' }
                                ]}>
                                  {supplier.dependency_percent.toFixed(0)}%
                                </Text>
                              </View>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#64748B" />
                          </TouchableOpacity>
                        ))
                      ) : (
                        <Text style={styles.noDataText}>{t('stats.noSupplierData')}</Text>
                      )}
                    </View>

                    {/* Inactive Suppliers Warning */}
                    {supplierOverview.inactive_suppliers.length > 0 && (
                      <View style={styles.inactiveCard}>
                        <View style={styles.inactiveHeader}>
                          <Ionicons name="time" size={24} color="#EF4444" />
                          <Text style={styles.inactiveTitle}>{t('stats.inactiveSuppliers')}</Text>
                        </View>
                        {supplierOverview.inactive_suppliers.slice(0, 5).map((supplier, index) => (
                          <TouchableOpacity 
                            key={supplier.supplier} 
                            style={styles.inactiveItem}
                            onPress={() => setSelectedSupplier(supplier.supplier)}
                          >
                            <View>
                              <Text style={styles.inactiveName}>{supplier.supplier}</Text>
                              <Text style={styles.inactiveMeta}>
                                {t('stats.lastDelivery')}: {supplier.last_delivery || '-'}
                              </Text>
                            </View>
                            <View style={styles.inactiveDays}>
                              <Text style={styles.inactiveDaysValue}>{supplier.days_inactive}</Text>
                              <Text style={styles.inactiveDaysLabel}>{t('stats.days')}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {/* High Dependency Alerts */}
                    {supplierOverview.high_dependency_alerts.length > 0 && (
                      <View style={styles.dependencyAlertCard}>
                        <View style={styles.dependencyAlertHeader}>
                          <Ionicons name="warning" size={24} color="#F59E0B" />
                          <Text style={styles.dependencyAlertTitle}>{t('stats.highDependency')}</Text>
                        </View>
                        <Text style={styles.dependencyAlertDesc}>{t('stats.highDependencyDesc')}</Text>
                        {supplierOverview.high_dependency_alerts.map((supplier, index) => (
                          <View key={supplier.supplier} style={styles.dependencyAlertItem}>
                            <Text style={styles.dependencyAlertName}>{supplier.supplier}</Text>
                            <Text style={styles.dependencyAlertPercent}>{supplier.dependency_percent.toFixed(1)}%</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <View style={styles.noDataContainer}>
                    <Ionicons name="business-outline" size={48} color="#64748B" />
                    <Text style={styles.noDataText}>{t('stats.noSupplierData')}</Text>
                  </View>
                )}
                <View style={{ height: 40 }} />
              </View>
            ) : activeTab === 'items' ? (
              /* ========== ITEMS TAB ========== */
              <View style={styles.suppliersContainer}>
                {loadingItems ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#8B5CF6" />
                    <Text style={styles.loadingText}>{t('stats.loadingData')}</Text>
                  </View>
                ) : (
                  <>
                    {/* Price Alerts Section */}
                    {priceAlerts.length > 0 && (
                      <View style={styles.priceAlertsCard}>
                        <View style={styles.priceAlertsHeader}>
                          <Ionicons name="alert-circle" size={24} color="#EF4444" />
                          <Text style={styles.priceAlertsTitle}>{t('stats.priceAlerts')}</Text>
                          {unreadAlerts > 0 && (
                            <View style={styles.alertCountBadge}>
                              <Text style={styles.alertCountText}>{unreadAlerts}</Text>
                            </View>
                          )}
                        </View>
                        
                        {priceAlerts.filter(a => a.status !== 'dismissed').slice(0, 5).map((alert) => (
                          <View 
                            key={alert.id} 
                            style={[styles.alertItem, alert.status === 'unread' && styles.alertItemUnread]}
                          >
                            <View style={styles.alertInfo}>
                              <Text style={styles.alertItemName} numberOfLines={1}>{alert.item_name}</Text>
                              <Text style={styles.alertSupplier}>{alert.supplier}</Text>
                              <View style={styles.alertPrices}>
                                <Text style={styles.alertOldPrice}>{alert.old_price.toFixed(2)}€</Text>
                                <Ionicons name="arrow-forward" size={14} color="#64748B" />
                                <Text style={styles.alertNewPrice}>{alert.new_price.toFixed(2)}€</Text>
                                <View style={styles.alertChangeBadge}>
                                  <Text style={styles.alertChangeText}>+{alert.change_percent}%</Text>
                                </View>
                              </View>
                            </View>
                            <View style={styles.alertActions}>
                              {alert.status === 'unread' && (
                                <TouchableOpacity 
                                  style={styles.alertActionBtn}
                                  onPress={() => markAlertAsRead(alert.id)}
                                >
                                  <Ionicons name="checkmark" size={18} color="#10B981" />
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity 
                                style={styles.alertActionBtn}
                                onPress={() => dismissAlert(alert.id)}
                              >
                                <Ionicons name="close" size={18} color="#EF4444" />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Item Totals */}
                    {itemStats && (
                      <View style={styles.supplierTotalsCard}>
                        <Text style={styles.supplierTotalsTitle}>{t('stats.itemsTitle')}</Text>
                        <View style={styles.supplierTotalsRow}>
                          <View style={styles.supplierTotalItem}>
                            <Text style={styles.supplierTotalValue}>
                              {itemStats.totals?.unique_items || 0}
                            </Text>
                            <Text style={styles.supplierTotalLabel}>{t('stats.uniqueItems')}</Text>
                          </View>
                          <View style={styles.supplierTotalItem}>
                            <Text style={styles.supplierTotalValue}>
                              {(itemStats.totals?.total_value || 0).toFixed(0)} €
                            </Text>
                            <Text style={styles.supplierTotalLabel}>{t('stats.totalValue')}</Text>
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Ranking Type Selector */}
                    <View style={styles.rankingSelector}>
                      <TouchableOpacity
                        style={[styles.rankingButton, itemRankingType === 'value' && styles.rankingButtonActive]}
                        onPress={() => setItemRankingType('value')}
                      >
                        <Text style={[styles.rankingButtonText, itemRankingType === 'value' && styles.rankingButtonTextActive]}>
                          {t('stats.topByValue')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rankingButton, itemRankingType === 'quantity' && styles.rankingButtonActive]}
                        onPress={() => setItemRankingType('quantity')}
                      >
                        <Text style={[styles.rankingButtonText, itemRankingType === 'quantity' && styles.rankingButtonTextActive]}>
                          {t('stats.topByQuantity')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rankingButton, itemRankingType === 'frequency' && styles.rankingButtonActive]}
                        onPress={() => setItemRankingType('frequency')}
                      >
                        <Text style={[styles.rankingButtonText, itemRankingType === 'frequency' && styles.rankingButtonTextActive]}>
                          {t('stats.byFrequency')}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Items Ranking List */}
                    <View style={styles.topSuppliersCard}>
                      <View style={styles.topSuppliersHeader}>
                        <Ionicons name="pricetags" size={24} color="#8B5CF6" />
                        <Text style={styles.topSuppliersTitle}>
                          {itemRankingType === 'value' ? t('stats.topByValue') : 
                           itemRankingType === 'quantity' ? t('stats.topByQuantity') : t('stats.byFrequency')}
                        </Text>
                      </View>
                      
                      {getCurrentItemRanking().length > 0 ? (
                        getCurrentItemRanking().map((item: any, index: number) => (
                          <TouchableOpacity 
                            key={item.item_name} 
                            style={styles.supplierItem}
                            onPress={() => setSelectedItem(item.item_name)}
                          >
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
                                {item.item_name}
                              </Text>
                              <Text style={styles.supplierMeta}>
                                {item.frequency} {t('stats.invoices')} • {item.supplier_count} {t('stats.suppliersLower')}
                              </Text>
                            </View>
                            <View style={styles.supplierAmounts}>
                              <Text style={styles.supplierAmount}>
                                {itemRankingType === 'quantity' 
                                  ? `${item.quantity.toFixed(1)} ${t('units.pieces')}`
                                  : `${item.total_value.toFixed(2)} €`}
                              </Text>
                              <View style={styles.itemTrendBadge}>
                                <Ionicons 
                                  name={item.trend_percent > 0 ? "trending-up" : item.trend_percent < 0 ? "trending-down" : "remove"} 
                                  size={12} 
                                  color={item.trend_percent > 5 ? '#EF4444' : item.trend_percent < -5 ? '#10B981' : '#64748B'} 
                                />
                                <Text style={[
                                  styles.itemTrendText,
                                  { color: item.trend_percent > 5 ? '#EF4444' : item.trend_percent < -5 ? '#10B981' : '#64748B' }
                                ]}>
                                  {item.trend_percent > 0 ? '+' : ''}{item.trend_percent.toFixed(0)}%
                                </Text>
                              </View>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#64748B" />
                          </TouchableOpacity>
                        ))
                      ) : (
                        <View style={styles.noDataContainer}>
                          <Ionicons name="pricetags-outline" size={48} color="#64748B" />
                          <Text style={styles.noDataText}>{t('stats.noItems')}</Text>
                        </View>
                      )}
                    </View>

                    {/* Price Trends Section */}
                    {itemStats?.price_trends?.length > 0 && (
                      <View style={styles.dependencyAlertCard}>
                        <View style={styles.dependencyAlertHeader}>
                          <Ionicons name="trending-up" size={24} color="#F59E0B" />
                          <Text style={styles.dependencyAlertTitle}>{t('stats.priceTrends')}</Text>
                        </View>
                        <Text style={styles.dependencyAlertDesc}>
                          {t('stats.highDependencyDesc').replace('доставчици', 'артикули').replace('suppliers', 'items')}
                        </Text>
                        {itemStats.price_trends.slice(0, 5).map((item: any) => (
                          <TouchableOpacity 
                            key={item.item_name} 
                            style={styles.dependencyAlertItem}
                            onPress={() => setSelectedItem(item.item_name)}
                          >
                            <Text style={styles.dependencyAlertName} numberOfLines={1}>{item.item_name}</Text>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={[
                                styles.dependencyAlertPercent,
                                { color: item.trend_percent > 0 ? '#EF4444' : '#10B981' }
                              ]}>
                                {item.trend_percent > 0 ? '+' : ''}{item.trend_percent.toFixed(1)}%
                              </Text>
                              <Text style={styles.itemAvgPrice}>{t('stats.avgPrice')}: {item.avg_price.toFixed(2)}€</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </>
                )}
                <View style={{ height: 40 }} />
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
      
      {/* Supplier Detail Modal */}
      {renderSupplierDetailModal()}
      
      {/* Item Detail Modal */}
      <Modal
        visible={!!selectedItem}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setSelectedItem(null);
          setItemPriceHistory(null);
          setItemBySupplier(null);
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity 
              style={styles.modalCloseButton}
              onPress={() => {
                setSelectedItem(null);
                setItemPriceHistory(null);
                setItemBySupplier(null);
              }}
            >
              <Ionicons name="close" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.modalTitle} numberOfLines={1}>{selectedItem}</Text>
            <View style={{ width: 40 }} />
          </View>

          {loadingItemDetail ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : (
            <ScrollView style={styles.modalContent}>
              {/* Item Statistics */}
              {itemPriceHistory?.statistics && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.priceHistory')}</Text>
                  <View style={styles.detailGrid}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailValue}>{itemPriceHistory.statistics.avg_price}€</Text>
                      <Text style={styles.detailLabel}>{t('stats.avgPrice')}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailValue}>{itemPriceHistory.statistics.min_price}€</Text>
                      <Text style={styles.detailLabel}>{t('stats.minPrice')}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailValue}>{itemPriceHistory.statistics.max_price}€</Text>
                      <Text style={styles.detailLabel}>{t('stats.maxPrice')}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={[styles.detailValue, { 
                        color: itemPriceHistory.statistics.trend_percent > 5 ? '#EF4444' : 
                               itemPriceHistory.statistics.trend_percent < -5 ? '#10B981' : '#8B5CF6'
                      }]}>
                        {itemPriceHistory.statistics.trend_percent > 0 ? '+' : ''}{itemPriceHistory.statistics.trend_percent}%
                      </Text>
                      <Text style={styles.detailLabel}>{t('stats.priceTrends')}</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Price History Chart */}
              {itemPriceHistory?.history?.length > 0 && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.monthlyTrend')}</Text>
                  <LineChart
                    data={itemPriceHistory.history.slice(-10).map((h: any) => ({
                      value: h.unit_price,
                      label: h.date.substring(5),
                      dataPointColor: '#8B5CF6',
                    }))}
                    width={chartWidth - 20}
                    height={150}
                    color="#8B5CF6"
                    thickness={2}
                    dataPointsColor="#8B5CF6"
                    yAxisColor="#334155"
                    xAxisColor="#334155"
                    yAxisTextStyle={{ color: '#64748B', fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: '#64748B', fontSize: 9 }}
                    hideRules
                    isAnimated
                    curved
                  />
                </View>
              )}

              {/* Supplier Comparison */}
              {itemBySupplier?.suppliers?.length > 0 && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.supplierCompare')}</Text>
                  
                  {/* Recommendation */}
                  {itemBySupplier.recommendation && (
                    <View style={styles.recommendationBanner}>
                      <Ionicons name="bulb" size={20} color="#10B981" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.recommendationTitle}>{t('stats.bestSupplier')}</Text>
                        <Text style={styles.recommendationText}>
                          {itemBySupplier.recommendation.best_supplier} - {itemBySupplier.recommendation.avg_price}€
                        </Text>
                        <Text style={styles.recommendationSavings}>
                          {t('stats.potentialSavings')}: {itemBySupplier.recommendation.potential_savings_percent}%
                        </Text>
                      </View>
                    </View>
                  )}
                  
                  {itemBySupplier.suppliers.map((sup: any, index: number) => (
                    <View key={sup.supplier} style={styles.supplierCompareItem}>
                      <View style={styles.supplierCompareRank}>
                        <Text style={[
                          styles.supplierCompareRankText,
                          index === 0 && { color: '#10B981' }
                        ]}>
                          #{index + 1}
                        </Text>
                      </View>
                      <View style={styles.supplierCompareInfo}>
                        <Text style={styles.supplierCompareName} numberOfLines={1}>{sup.supplier}</Text>
                        <Text style={styles.supplierCompareMeta}>
                          {sup.purchase_count} {t('stats.times')} • {t('stats.lastDelivery')}: {sup.last_purchase || t('stats.noValue')}
                        </Text>
                      </View>
                      <View style={styles.supplierComparePrices}>
                        <Text style={styles.supplierComparePrice}>{sup.avg_price}€</Text>
                        <Text style={styles.supplierComparePriceLabel}>{t('stats.avgPrice')}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Recent Price History */}
              {itemPriceHistory?.history?.length > 0 && (
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>{t('stats.recentInvoices')}</Text>
                  {itemPriceHistory.history.slice(-5).reverse().map((h: any, index: number) => (
                    <View key={index} style={styles.recentInvoiceItem}>
                      <View>
                        <Text style={styles.recentInvoiceNumber}>№{h.invoice_number}</Text>
                        <Text style={styles.recentInvoiceDate}>{h.date} • {h.supplier}</Text>
                      </View>
                      <Text style={styles.recentInvoiceAmount}>{h.unit_price.toFixed(2)}€</Text>
                    </View>
                  ))}
                </View>
              )}
              
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
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
  
  // Executive Summary
  executiveSummaryCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  execSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  execSummaryTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  execSummaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  execItem: {
    alignItems: 'center',
  },
  execValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  execLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  concentrationRow: {
    marginBottom: 12,
  },
  concentrationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  concentrationLabel: {
    fontSize: 12,
    color: '#64748B',
    width: 100,
  },
  concentrationBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  concentrationFill: {
    height: '100%',
    borderRadius: 4,
  },
  concentrationValue: {
    fontSize: 12,
    color: 'white',
    fontWeight: 'bold',
    width: 50,
    textAlign: 'right',
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F59E0B20',
    padding: 12,
    borderRadius: 8,
  },
  alertText: {
    color: '#F59E0B',
    fontSize: 13,
    flex: 1,
  },
  
  // Supplier Totals
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
  
  // Chart Controls
  chartControlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  chartTypeSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
  },
  chartTypeButton: {
    padding: 10,
    borderRadius: 6,
  },
  chartTypeButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  rankingSelector: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
  },
  rankingButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  rankingButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  rankingButtonText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
  },
  rankingButtonTextActive: {
    color: 'white',
  },
  
  // Pie Chart
  pieChartContainer: {
    alignItems: 'center',
  },
  pieCenter: {
    alignItems: 'center',
  },
  pieCenterValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  pieCenterLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  legendContainer: {
    marginTop: 16,
    width: '100%',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 3,
    marginRight: 8,
  },
  legendText: {
    flex: 1,
    color: 'white',
    fontSize: 13,
  },
  legendValue: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: 'bold',
  },
  
  // Top Suppliers
  topSuppliersCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
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
    marginRight: 8,
  },
  supplierAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#10B981',
  },
  dependencyBadge: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  dependencyText: {
    fontSize: 10,
    color: '#8B5CF6',
    fontWeight: 'bold',
  },
  
  // Inactive Suppliers
  inactiveCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  inactiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  inactiveTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  inactiveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  inactiveName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  inactiveMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  inactiveDays: {
    alignItems: 'center',
  },
  inactiveDaysValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  inactiveDaysLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  
  // High Dependency Alert
  dependencyAlertCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  dependencyAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  dependencyAlertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  dependencyAlertDesc: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 12,
  },
  dependencyAlertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  dependencyAlertName: {
    fontSize: 14,
    color: 'white',
  },
  dependencyAlertPercent: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalCloseButton: {
    padding: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    textAlign: 'center',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Detail Card
  detailCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailItem: {
    width: '47%',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  detailValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  detailLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
  },
  detailDates: {
    marginTop: 16,
  },
  detailDateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailDateLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  detailDateValue: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Anomaly
  anomalyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  anomalyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  anomalyInvoice: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  anomalyDate: {
    fontSize: 11,
    color: '#64748B',
  },
  anomalyAmount: {
    alignItems: 'flex-end',
  },
  anomalyValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  anomalyDeviation: {
    fontSize: 10,
    color: '#EF4444',
    fontWeight: 'bold',
  },
  
  // Recent Invoices
  recentInvoiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  recentInvoiceNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
  },
  recentInvoiceDate: {
    fontSize: 11,
    color: '#64748B',
  },
  recentInvoiceAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#10B981',
  },
  
  // Alert Badge on Tab
  alertBadge: {
    position: 'absolute',
    top: -5,
    right: -8,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  
  // Price Alerts Card
  priceAlertsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  priceAlertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  priceAlertsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#EF4444',
    flex: 1,
  },
  alertCountBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  alertCountText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  alertItemUnread: {
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
  },
  alertInfo: {
    flex: 1,
  },
  alertItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  alertSupplier: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  alertPrices: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  alertOldPrice: {
    fontSize: 12,
    color: '#64748B',
    textDecorationLine: 'line-through',
  },
  alertNewPrice: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  alertChangeBadge: {
    backgroundColor: '#EF444420',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  alertChangeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  alertActions: {
    flexDirection: 'row',
    gap: 8,
  },
  alertActionBtn: {
    padding: 8,
    backgroundColor: '#1E293B',
    borderRadius: 8,
  },
  
  // Item Trend Badge
  itemTrendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  itemTrendText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  itemAvgPrice: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  
  // Recommendation Banner
  recommendationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#10B98120',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  recommendationTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#10B981',
  },
  recommendationText: {
    fontSize: 14,
    color: 'white',
    marginTop: 2,
  },
  recommendationSavings: {
    fontSize: 11,
    color: '#10B981',
    marginTop: 4,
  },
  
  // Supplier Compare
  supplierCompareItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  supplierCompareRank: {
    width: 30,
    alignItems: 'center',
  },
  supplierCompareRankText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#64748B',
  },
  supplierCompareInfo: {
    flex: 1,
    marginLeft: 8,
  },
  supplierCompareName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  supplierCompareMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  supplierComparePrices: {
    alignItems: 'flex-end',
  },
  supplierComparePrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  supplierComparePriceLabel: {
    fontSize: 10,
    color: '#64748B',
  },
});
